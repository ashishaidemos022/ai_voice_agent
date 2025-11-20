import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface QueryRequest {
  table: string;
  action: 'select' | 'count' | 'aggregate';
  filters?: Record<string, any>;
  columns?: string;
  limit?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { table, action, filters, columns, limit }: QueryRequest = await req.json();

    if (!table || !action) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: table and action' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let query = supabase.from(table);

    if (action === 'select') {
      query = query.select(columns || '*');
      
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          query = query.eq(key, value);
        }
      }
      
      if (limit) {
        query = query.limit(limit);
      }
    } else if (action === 'count') {
      query = query.select('*', { count: 'exact', head: true });
      
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          query = query.eq(key, value);
        }
      }
    }

    const { data, error, count } = await query;

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: action === 'count' ? { count } : data,
        action,
        table 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});