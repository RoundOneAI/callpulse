import { create } from 'zustand';
import { supabase } from '../services/supabase';
import type { Profile, Company } from '../types';

interface AuthState {
  user: Profile | null;
  company: Company | null;
  loading: boolean;
  initialized: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: {
    email: string;
    password: string;
    fullName: string;
    companyName?: string;
    companyId?: string;
    role?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  company: null,
  loading: false,
  initialized: false,

  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (profile) {
          const { data: company } = await supabase
            .from('companies')
            .select('*')
            .eq('id', profile.company_id)
            .single();

          set({ user: profile, company, initialized: true });
          return;
        }
      }
    } catch (err) {
      console.error('Auth init error:', err);
    }
    set({ initialized: true });
  },

  signIn: async (email, password) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      const { data: company } = await supabase
        .from('companies')
        .select('*')
        .eq('id', profile?.company_id)
        .single();

      set({ user: profile, company, loading: false });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  signUp: async ({ email, password, fullName, companyName, companyId, role }) => {
    set({ loading: true });
    try {
      let targetCompanyId = companyId;

      // If creating a new company
      if (!targetCompanyId && companyName) {
        const { data: newCompany, error: companyError } = await supabase
          .from('companies')
          .insert({ name: companyName })
          .select()
          .single();
        if (companyError) throw companyError;
        targetCompanyId = newCompany.id;
      }

      if (!targetCompanyId) throw new Error('Company ID required');

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            company_id: targetCompanyId,
            role: role || 'admin',
          },
        },
      });

      if (error) throw error;

      set({ loading: false });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, company: null });
  },
}));
