import { create } from 'zustand';
import { supabase } from '../services/supabase';
import type { Profile, Company } from '../types';

/** Auth error codes from Supabase - see https://supabase.com/docs/guides/auth/debugging/error-codes */
const RATE_LIMIT_CODES = [
  'over_email_send_rate_limit', // Too many emails to this address
  'over_request_rate_limit', // Too many requests from this IP
] as const;

export interface MagicLinkResult {
  success: boolean;
  error?: string;
}

interface AuthState {
  user: Profile | null;
  company: Company | null;
  loading: boolean;
  initialized: boolean;
  needsOnboarding: boolean;
  signInWithMagicLink: (email: string) => Promise<MagicLinkResult>;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

async function loadProfile(userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (!profile) return { profile: null, company: null };

  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', profile.company_id)
    .single();

  return { profile, company };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  company: null,
  loading: false,
  initialized: false,
  needsOnboarding: false,

  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { profile, company } = await loadProfile(session.user.id);
        if (profile) {
          set({ user: profile, company, initialized: true, needsOnboarding: false });
        } else {
          // Authenticated but no profile — needs onboarding
          set({ initialized: true, needsOnboarding: true });
        }
        // Set up listener after initial load
        setupAuthListener(set);
        return;
      }
    } catch (err) {
      console.error('Auth init error:', err);
    }
    set({ initialized: true });
    setupAuthListener(set);
  },

  refreshProfile: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { profile, company } = await loadProfile(session.user.id);
    if (profile) {
      set({ user: profile, company, needsOnboarding: false });
    }
  },

  signInWithMagicLink: async (email): Promise<MagicLinkResult> => {
    const normalizedEmail = email.trim().toLowerCase();
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        const code = (error as { code?: string }).code;
        const isRateLimit = code && RATE_LIMIT_CODES.includes(code as (typeof RATE_LIMIT_CODES)[number]);

        // Log for debugging - visible in browser console and can be sent to analytics
        console.warn('[Auth] Magic link failed', {
          email: normalizedEmail,
          code,
          message: error.message,
          isRateLimit,
        });

        if (isRateLimit) {
          return {
            success: false,
            error: 'Too many requests. Please wait a minute before trying again.',
          };
        }

        // email_address_not_authorized = default SMTP only allows org members
        if (code === 'email_address_not_authorized') {
          return {
            success: false,
            error: 'This email is not authorized. Contact your admin to get invited.',
          };
        }

        return { success: false, error: error.message };
      }

      // Success - Supabase may still throttle silently; we surface success and let user check email
      console.info('[Auth] Magic link sent', {
        email: normalizedEmail,
        hasUser: !!data?.user,
      });
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send magic link';
      console.error('[Auth] Magic link error', { email: normalizedEmail, error: err });
      return { success: false, error: msg };
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, company: null, needsOnboarding: false });
  },
}));

let listenerSetUp = false;

function setupAuthListener(set: (state: Partial<AuthState>) => void) {
  if (listenerSetUp) return;
  listenerSetUp = true;

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      const { profile, company } = await loadProfile(session.user.id);
      if (profile) {
        set({ user: profile, company, needsOnboarding: false });
      } else {
        set({ needsOnboarding: true });
      }
    } else if (event === 'SIGNED_OUT') {
      set({ user: null, company: null, needsOnboarding: false });
    }
  });
}
