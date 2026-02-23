import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Verify the caller is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Parse request
    const { callIds } = await req.json() as { callIds: string[] };

    if (!callIds || callIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No callIds provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Use service role for the actual deletion (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 4. Get file_paths for storage cleanup
    const { data: calls, error: fetchError } = await supabaseAdmin
      .from('calls')
      .select('id, file_path')
      .in('id', callIds);

    if (fetchError) throw fetchError;

    // 5. Delete audio files from storage
    const filePaths = (calls || [])
      .map((c: { file_path: string | null }) => c.file_path)
      .filter((p: string | null): p is string => !!p);

    if (filePaths.length > 0) {
      const { error: storageError } = await supabaseAdmin.storage
        .from('call-recordings')
        .remove(filePaths);

      if (storageError) {
        console.error('Failed to delete some audio files:', storageError);
      }
    }

    // 6. Delete call rows (cascades to analyses + coaching items)
    const { data: deleted, error: deleteError } = await supabaseAdmin
      .from('calls')
      .delete()
      .in('id', callIds)
      .select('id');

    if (deleteError) throw deleteError;

    return new Response(
      JSON.stringify({ deleted: deleted?.length ?? 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('delete-calls error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
