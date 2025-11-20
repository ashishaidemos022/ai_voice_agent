const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface ApiRequest {
  service: 'weather' | 'time' | 'quote';
  params?: Record<string, any>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { service, params }: ApiRequest = await req.json();

    if (!service) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: service' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let result: any;

    switch (service) {
      case 'weather':
        result = {
          service: 'weather',
          location: params?.location || 'San Francisco',
          temperature: Math.floor(Math.random() * 30) + 50,
          condition: ['Sunny', 'Cloudy', 'Rainy', 'Windy'][Math.floor(Math.random() * 4)],
          humidity: Math.floor(Math.random() * 60) + 30,
          note: 'This is mock weather data. Integrate with a real API like OpenWeatherMap for production.'
        };
        break;

      case 'time':
        const timezone = params?.timezone || 'America/Los_Angeles';
        const date = new Date();
        result = {
          service: 'time',
          timezone,
          current_time: date.toLocaleString('en-US', { timeZone: timezone }),
          unix_timestamp: date.getTime(),
          iso_string: date.toISOString()
        };
        break;

      case 'quote':
        const quotes = [
          { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
          { text: 'Innovation distinguishes between a leader and a follower.', author: 'Steve Jobs' },
          { text: 'Stay hungry, stay foolish.', author: 'Steve Jobs' },
          { text: 'The best time to plant a tree was 20 years ago. The second best time is now.', author: 'Chinese Proverb' },
          { text: 'Your time is limited, so don\'t waste it living someone else\'s life.', author: 'Steve Jobs' }
        ];
        result = {
          service: 'quote',
          ...quotes[Math.floor(Math.random() * quotes.length)]
        };
        break;

      default:
        return new Response(
          JSON.stringify({ error: `Unknown service: ${service}` }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
    }

    return new Response(
      JSON.stringify({ success: true, result }),
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