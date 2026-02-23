# Email Templates

Templates for Supabase Authentication emails. Use these when configuring email templates in the Supabase Dashboard under **Authentication → Email**.

## Magic Link

**Subject:** `Your Magic Link`

**File:** `magic-link.html`

### Available placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{.ConfirmationURL}}` | One-time sign-in link |
| `{{.Token}}` | Raw token (use with custom redirect) |
| `{{.TokenHash}}` | Hashed token |
| `{{.SiteURL}}` | Site URL from project settings |
| `{{.Email}}` | User's email address |
| `{{.Data}}` | Custom metadata passed to `signInWithOtp` |
| `{{.RedirectTo}}` | Redirect URL after sign-in |

### How to use

1. Go to **Supabase Dashboard** → **Authentication** → **Email** → **Magic Link**
2. Set **Subject** to: `Your Magic Link`
3. Copy the HTML from `magic-link.html` into the **Body** field
4. Click **Save changes**
