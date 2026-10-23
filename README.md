# Google OAuth Authentication System

A complete authentication system with Google OAuth integration, featuring a secure backend API and React frontend that demonstrates proper token exchange patterns.

## 🏗️ Architecture

- **Backend**: Node.js Express API with Google ID token verification via JWKS
- **Frontend**: React SPA with Google OAuth integration
- **Security**: Cryptographic token validation, no frontend auth state trust

## 📋 Prerequisites

- Node.js 18+ and npm
- Google Cloud Console account for OAuth credentials
- HTTPS setup (required for production Google OAuth)

## 🚀 Quick Start

### 1. Clone and Setup
```bash
# Clone repository
cd nexora

# Setup backend
cd backend
npm install
cp .env.example .env
# Edit .env with your Google Client ID and JWT secret

# Setup frontend
cd ../frontend
npm install
cp .env.example .env
# Edit .env with your Google Client ID and backend URL
```

### 2. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized origins: `http://localhost:5173` (dev), your production domain
6. Add redirect URIs: `http://localhost:5173` (dev), your production domain

### 3. Run the System

```bash
# Terminal 1: Start backend
cd backend
npm run dev

# Terminal 2: Start frontend
cd frontend
npm run dev
```

### 4. Test Authentication

1. Open http://localhost:5173
2. Click "Sign in with Google"
3. Complete Google OAuth flow
4. Click "Call /private" to test authenticated API access

## 📁 Project Structure

```
nexora/
├── backend/              # Express API server
│   ├── src/
│   │   ├── auth/         # Google verification & JWT management
│   │   ├── middlewares/  # Auth middleware & error handling
│   │   ├── routes/       # API endpoints
│   │   ├── store/        # User storage (in-memory)
│   │   └── config/       # Environment & constants
│   ├── package.json
│   ├── .env.example
│   └── README.md
├── frontend/             # React SPA
│   ├── src/
│   │   ├── api/          # Backend API functions
│   │   ├── App.jsx       # Main component
│   │   └── main.jsx      # Entry point
│   ├── package.json
│   ├── .env.example
│   └── README.md
├── system-overview.md    # Architecture documentation
└── README.md            # This file
```

## ⚙️ Backend Configuration

### Required Environment Variables (.env)

```bash
# Server
PORT=8000

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# JWT Configuration
APP_JWT_SECRET=your_very_long_random_secret_string_minimum_32_characters
APP_JWT_EXPIRE_MINUTES=60

# Optional
CORS_ORIGIN=http://localhost:5173
```

### Google Client ID Setup

1. In Google Cloud Console → APIs & Services → Credentials
2. Copy the Client ID (ends with `.apps.googleusercontent.com`)
3. Add to backend `.env` as `GOOGLE_CLIENT_ID`

### JWT Secret Generation

```bash
# Generate a secure random string
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## ⚙️ Frontend Configuration

### Required Environment Variables (.env)

```bash
# Google OAuth (same as backend)
VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# Backend API URL
VITE_BACKEND_URL=http://localhost:8000
```

## 🏃 Running the Applications

### Backend
```bash
cd backend
npm run dev    # Development with auto-restart
npm start      # Production mode
```

**Available at**: http://localhost:8000

### Frontend
```bash
cd frontend
npm run dev    # Development server
npm run build  # Production build
npm run preview # Preview production build
```

**Available at**: http://localhost:5173

## 🧪 Testing the Integration

### Manual Testing

1. **Public Endpoint**:
   ```bash
   curl http://localhost:8000/public
   ```

2. **Private Endpoint** (should fail):
   ```bash
   curl http://localhost:8000/private
   ```

3. **Authentication Flow**:
   - Use browser to test complete OAuth flow
   - Check browser network tab for API calls
   - Verify JWT tokens in responses

### API Endpoints

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| GET | `/public` | No | Public welcome message |
| POST | `/auth/google` | No | Exchange Google token for backend JWT |
| GET | `/private` | Yes | Protected endpoint with user data |

### Sample API Usage

```bash
# Get Google ID token from frontend, then:
curl -X POST http://localhost:8000/auth/google \
  -H "Content-Type: application/json" \
  -d '{"google_id_token":"YOUR_GOOGLE_TOKEN"}'

# Use returned access_token for private calls:
curl http://localhost:8000/private \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## 🔧 Troubleshooting

### Common Issues

**"Google Client ID not configured"**
- Check `.env` files have correct `GOOGLE_CLIENT_ID`
- Verify Google Cloud Console credentials are valid

**"Backend not responding"**
- Ensure backend is running on port 8000
- Check firewall settings
- Verify no port conflicts

**"CORS errors"**
- Backend must be running for CORS headers
- Check `CORS_ORIGIN` in backend `.env`
- Frontend dev server runs on 5173 by default

**"OAuth redirect errors"**
- Verify authorized origins in Google Cloud Console
- Ensure HTTPS in production
- Check redirect URIs match exactly

**"Invalid token" errors**
- Verify JWT secret is identical in backend
- Check token expiration (default 60 minutes)
- Ensure no extra spaces in environment variables

### Debug Mode

Enable detailed logging:
```bash
# Backend debug logs
DEBUG=* npm run dev

# Frontend browser dev tools
# Check Console and Network tabs
```

### Environment Validation

Test configuration:
```bash
# Backend config check
cd backend && node -e "console.log(require('./src/config/env.js').config)"

# Frontend env check
cd frontend && npm run dev  # Check browser console for VITE_ variables
```

## 🚀 Production Deployment

### Backend Deployment
```bash
# Build and deploy
cd backend
npm run build  # If using TypeScript
# Deploy to Heroku, Railway, or Docker
```

### Frontend Deployment
```bash
# Build for production
cd frontend
npm run build

# Deploy dist/ folder to:
# - Vercel: vercel --prod
# - Netlify: netlify deploy --prod
# - AWS S3 + CloudFront
```

### Production Checklist

- [ ] HTTPS enabled (required for Google OAuth)
- [ ] Environment variables configured
- [ ] Google OAuth origins updated for production domain
- [ ] Database configured (replace in-memory store)
- [ ] Monitoring and logging enabled
- [ ] Rate limiting configured
- [ ] Security headers verified

## 📚 Additional Resources

- [System Architecture](system-overview.md) - Detailed technical overview
- [Backend Documentation](backend/README.md) - API reference and setup
- [Frontend Documentation](frontend/README.md) - UI guide and development
- [Google OAuth Setup](https://developers.google.com/identity/protocols/oauth2) - Official documentation

## 🤝 Contributing

1. Follow the existing code style
2. Add tests for new features
3. Update documentation
4. Ensure security best practices

## 📄 License

This project is for educational and demonstration purposes. Adapt the security patterns for your production needs.