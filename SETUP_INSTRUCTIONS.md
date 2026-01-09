# Setup Instructions for Authentication & Landing Page

## Overview

This implementation adds:
1. **Marketing Landing Page** at `/` with features showcase
2. **Setup/Login Page** at `/setup` for ESPN authentication
3. **Demo Mode** for exploring the app without ESPN credentials
4. **Secure Session Management** with encrypted credentials
5. **Route Protection** requiring authentication for core pages

## Security Features

- ESPN credentials are **encrypted at rest** using AES-256-GCM
- Credentials are **never sent to the browser** after initial submit
- Session managed via **HttpOnly cookies** (not localStorage)
- Rate limiting on credential submission
- Input validation and sanitized logs

---

## Setup Steps

### 1. Install Dependencies

```bash
# Install new backend dependencies
cd apps/api
pnpm install

# Install new frontend dependencies (if needed)
cd apps/web
pnpm install
```

### 2. Generate Encryption Key

Generate a 32-byte encryption key for credentials:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy the output and add it to your `.env` file.

### 3. Update Environment Variables

Add these to your `.env` file in the project root:

```env
# Existing variables
DATABASE_URL="postgresql://user:password@localhost:5432/dbname"
ESPN_BASE_URL=https://lm-api-reads.fantasy.espn.com
ESPN_PLATFORM_VERSION=3
ESPN_LEAGUE_ID=your_league_id
ESPN_SEASON_ID=2026
ESPN_S2=your_espn_s2_cookie
ESPN_SWID={your_swid_with_braces}

# NEW: Security - Credentials Encryption (REQUIRED)
CREDENTIALS_ENCRYPTION_KEY=<paste_generated_key_here>

# NEW: Demo Mode Configuration (OPTIONAL)
# Option 1: Use already ingested league data (RECOMMENDED)
DEMO_LEAGUE_ID=646094327  # Use your current ESPN_LEAGUE_ID or a specific demo league
DEMO_SEASON_ID=2026
DEMO_TEAM_ID=1  # Optional: specific team for demo

# Option 2: Use separate demo credentials (if Option 1 not feasible)
# DEMO_ESPN_S2=demo_account_espn_s2
# DEMO_ESPN_SWID={demo_account_swid}
```

### 4. Run Prisma Migration

Create the Session table:

```bash
cd apps/api
pnpm prisma migrate dev --name add_session_table
```

### 5. Seed Demo Data (if using Option 1)

If you want demo mode to work with pre-ingested data, ensure you have data in your database for the league specified in `DEMO_LEAGUE_ID`:

```bash
# Ingest your league data first (if not already done)
curl -X POST http://localhost:3001/ingest/espn
```

### 6. Start the Servers

```bash
# From project root
pnpm dev
```

This starts:
- **Backend**: http://localhost:3001
- **Frontend**: http://localhost:5173

---

## Usage

### For Users with ESPN Account

1. Visit http://localhost:5173
2. Click "Get Started"
3. Enter ESPN credentials:
   - League ID (from ESPN URL)
   - Season Year (e.g., 2026)
   - ESPN_S2 cookie
   - SWID cookie
4. Click "Validate & Connect"
5. Select your team
6. Click "Continue"

### For Demo Mode

1. Visit http://localhost:5173
2. Click "View Demo" OR click "Use Demo Data" on the setup page
3. Explore the app with pre-loaded data

### Logging Out

- Go to Settings page
- Click "Logout"
- Returns to landing page

---

## How It Works

### Backend (apps/api)

**New Files:**
- `src/lib/encryption.ts` - AES-256-GCM encryption utilities
- `src/lib/sessionManager.ts` - Session CRUD operations
- `src/routes/auth.ts` - Authentication endpoints
- `src/middleware/requireAuth.ts` - Auth middleware

**New Endpoints:**
- `POST /auth/espn/connect` - Validate ESPN credentials
- `POST /auth/espn/select-team` - Bind team to session
- `POST /auth/demo/start` - Start demo session
- `GET /auth/me` - Get current session info
- `POST /auth/logout` - Clear session

**Database:**
- New `Session` table stores encrypted credentials and session data

### Frontend (apps/web)

**New Files:**
- `pages/Landing.tsx` + `Landing.css` - Marketing page
- `pages/Setup.tsx` + `Setup.css` - Authentication page
- `contexts/AuthContext.tsx` - Auth state management
- `components/ProtectedRoute.tsx` - Route protection

**Route Changes:**
- `/` - Landing page (public)
- `/setup` - Setup/login page (public)
- `/dashboard`, `/streaming`, etc. - Now protected, require auth

---

## Security Notes

### What's Protected

✅ ESPN credentials encrypted with AES-256-GCM  
✅ Session ID in HttpOnly cookie (not accessible to JavaScript)  
✅ Credentials never returned in API responses  
✅ Credentials never logged  
✅ Rate limiting on credential submission (10 attempts per 15 min)  
✅ Session expiry (24 hours)  

### What's NOT Done (Production Considerations)

⚠️ No HTTPS enforcement (add in production)  
⚠️ In-memory rate limiting (resets on restart - use Redis in prod)  
⚠️ No CSRF protection (consider adding `csurf` middleware)  
⚠️ No session cleanup on server restart (sessions in DB persist)  

---

## Troubleshooting

### "CREDENTIALS_ENCRYPTION_KEY environment variable is required"

**Solution:** Generate and add the key to `.env` (see Step 2-3 above)

### "Demo mode not configured"

**Solution:** Add `DEMO_LEAGUE_ID` to `.env` or ingest demo data

### "Session expired"

**Solution:** Sessions expire after 24 hours. Re-authenticate at `/setup`

### "No teams found in this league"

**Solution:** Verify your ESPN credentials and league ID are correct

### CORS errors

**Solution:** Ensure `Access-Control-Allow-Credentials: true` is set in CORS config (already done)

---

## Testing Checklist

### Manual Testing

- [ ] Landing page loads at `/`
- [ ] "Get Started" navigates to `/setup`
- [ ] "View Demo" starts demo mode
- [ ] Can connect with valid ESPN credentials
- [ ] Invalid credentials show error message
- [ ] Rate limiting works (10+ attempts)
- [ ] Can select team after connection
- [ ] Redirects to `/dashboard` after team selection
- [ ] Protected pages redirect to `/setup` when not authenticated
- [ ] Demo mode works without ESPN account
- [ ] Session persists across page refreshes
- [ ] Logout clears session and redirects to landing
- [ ] Settings page shows current session info

### Security Testing

- [ ] Credentials not visible in browser DevTools (Network, Application)
- [ ] Credentials not in API response JSON
- [ ] Session cookie is HttpOnly
- [ ] Cookies not stored in localStorage
- [ ] Can't access protected pages without valid session

---

## Next Steps (Optional Enhancements)

1. **Add CSRF protection** for production
2. **Implement session refresh** to extend expiry on activity
3. **Add "Remember Me"** option with longer session
4. **Email verification** for account recovery
5. **Multi-league support** - allow switching between leagues
6. **Persistent session storage** - Redis for distributed systems
7. **Add logging/monitoring** for security events

---

## File Structure

```
apps/
├── api/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── encryption.ts          (NEW)
│   │   │   └── sessionManager.ts      (NEW)
│   │   ├── middleware/
│   │   │   └── requireAuth.ts         (NEW)
│   │   ├── routes/
│   │   │   └── auth.ts                (NEW)
│   │   └── index.ts                   (MODIFIED - added cookie-parser & auth routes)
│   └── package.json                   (MODIFIED - added cookie-parser)
│
├── web/
│   ├── src/
│   │   ├── components/
│   │   │   └── ProtectedRoute.tsx     (NEW)
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx        (NEW)
│   │   ├── pages/
│   │   │   ├── Landing.tsx            (NEW)
│   │   │   ├── Landing.css            (NEW)
│   │   │   ├── Setup.tsx              (NEW)
│   │   │   ├── Setup.css              (NEW)
│   │   │   ├── Settings.tsx           (MODIFIED - added logout)
│   │   │   └── Settings.css           (MODIFIED - added session styles)
│   │   └── App.tsx                    (MODIFIED - added routes & AuthProvider)
│
└── prisma/
    └── schema.prisma                  (MODIFIED - added Session model)
```

---

## Support

If you encounter issues, check:
1. Environment variables are set correctly
2. Database migration completed successfully
3. Both servers are running
4. Browser console for frontend errors
5. Terminal for backend logs

For questions or issues, please check the console logs for detailed error messages.

