import { supabase } from './supabase';

type InviteResponse = {
  success?: boolean;
  error?: string;
};

export async function inviteUserByEmail(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) {
    throw new Error('Please enter an email address.');
  }

  const { data, error } = await supabase.functions.invoke<InviteResponse>('invite-user', {
    body: { email: trimmed }
  });

  if (error) {
    throw error;
  }
  if (data?.error) {
    throw new Error(data.error);
  }
}
