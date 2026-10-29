export function createAdminAuthenticator({ env = process.env, fetchImpl = fetch } = {}) {
  return async function authenticateAdmin(request) {
    const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
    const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
    const adminEmail = env.BIZPOA_ADMIN_EMAIL?.trim().toLowerCase();
    if (!supabaseUrl || !publishableKey || !adminEmail) {
      return {
        ok: false,
        status: 503,
        error: 'Password sign-in is not configured. Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and BIZPOA_ADMIN_EMAIL in the backend environment.',
      };
    }

    const accessToken = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) {
      return { ok: false, status: 401, error: 'Sign in with your Bizpoa email and password.' };
    }

    let response;
    try {
      response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return { ok: false, status: 502, error: 'Could not verify your Supabase session. Please try again.' };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 401, error: 'Your sign-in has expired. Please sign in again.' };
    }
    if (!response.ok) {
      return { ok: false, status: 502, error: 'Could not verify your Supabase session. Please try again.' };
    }

    let user;
    try {
      user = await response.json();
    } catch {
      return { ok: false, status: 502, error: 'Supabase returned an invalid session response.' };
    }

    if (!user.email || user.email.toLowerCase() !== adminEmail) {
      return { ok: false, status: 403, error: 'This Supabase account is not authorized for the Bizpoa admin dashboard.' };
    }
    return { ok: true, user };
  };
}
