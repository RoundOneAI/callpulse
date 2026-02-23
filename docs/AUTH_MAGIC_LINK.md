# Magic Link Auth – Setup & Troubleshooting

This doc covers how magic link sign-in works in CallPulse and how to make it reliable.

## How It Works

1. User enters email on `/login`
2. App calls `supabase.auth.signInWithOtp()` (new users are created automatically)
3. Supabase sends a magic link email
4. User clicks the link → redirected to `/auth/callback` → session created → dashboard

## Why Emails Sometimes Don’t Send

### 1. Rate limits (most common)

Supabase enforces strict limits on the default SMTP:

| Limit | Default | Notes |
|-------|---------|-------|
| **Emails per hour** | 2 | Shared across signup, recover, OTP |
| **OTP requests per user** | 1 per 60 seconds | Per email address |

When limits are hit, Supabase returns `over_email_send_rate_limit` or `over_request_rate_limit`. The app now surfaces these with clear messages and a 60s cooldown.

### 2. Unauthorized email (dev only)

With the default SMTP, emails can only be sent to **Supabase organization members**. For other addresses you’ll see `email_address_not_authorized`.

**Fix:** Add test emails as team members in [Supabase Dashboard → Organization Settings](https://supabase.com/dashboard/account), or configure custom SMTP.

### 3. User doesn’t exist 
New users are created automatically when they request a magic link. After signing in, they go through onboarding to create or join a company.

## Where to See Logs

### Supabase Dashboard

1. **Auth Logs**  
   [Dashboard → Your Project → Auth → Logs](https://supabase.com/dashboard/project/_/auth/logs)  
   Shows sign-in attempts, OTP requests, and errors.

2. **Auth Audit Logs**  
   [Dashboard → Auth → Audit Logs](https://supabase.com/dashboard/project/_/auth/audit-logs)  
   Higher-level auth events (signups, logins, etc.).

3. **Rate Limits**  
   [Dashboard → Auth → Rate Limits](https://supabase.com/dashboard/project/_/auth/rate-limits)  
   View and adjust limits (requires custom SMTP for email limits).

### Browser Console

The app logs auth events with the `[Auth]` prefix:

- `[Auth] Magic link sent` – success
- `[Auth] Magic link failed` – error with code and message

## Making It Production-Ready

### 1. Custom SMTP (recommended)

The default SMTP is for development only. For production:

1. Go to [Dashboard → Auth → SMTP Settings](https://supabase.com/dashboard/project/_/auth/smtp)
2. Configure a provider (Resend, SendGrid, AWS SES, etc.)
3. This removes the 2 emails/hour limit and improves deliverability

### 2. URL configuration

Ensure redirect URLs are correct:

- [Dashboard → Auth → URL Configuration](https://supabase.com/dashboard/project/_/auth/url-configuration)
- **Site URL:** your production URL (e.g. `https://app.callpulse.com`)
- **Redirect URLs:** add `https://app.callpulse.com/auth/callback` (and any other allowed origins)

### 3. Email templates

Customize magic link emails at [Dashboard → Auth → Email Templates](https://supabase.com/dashboard/project/_/auth/templates).

## App-Side Improvements

The app now includes:

- **Rate limit handling** – Detects `over_email_send_rate_limit` and `over_request_rate_limit`, shows a clear message
- **Structured logging** – `[Auth]` logs in the browser console for debugging
- **Open signup** – New users can sign up via magic link and complete onboarding
