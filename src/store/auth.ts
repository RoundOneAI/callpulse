import { create } from 'zustand';
import { supabase } from '../services/supabase';
import type { Profile, Company } from '../types';

interface AuthState {
  user: Profile | null;
  company: Company | null;
  loading: boolean;
  initialized: boolean;
  needsOnboarding: boolean;
  signInWithMagicLink: (email: string) => Promise<void>;
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

  signInWithMagicLink: async (email) => {
    set({ loading: true });
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
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
