# Deployment Guide

## Option 1: Railway (Recommended)

### Steps:
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Railway will automatically detect it's a Node.js app
6. Your app will be deployed at `https://your-app-name.railway.app`

### Environment Variables (Optional):
- `PORT` - Railway sets this automatically
- `JWT_SECRET` - Set a strong secret for production

## Option 2: Render

### Steps:
1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Click "New" → "Web Service"
4. Connect your GitHub repository
5. Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: Node
6. Deploy!

## Option 3: Vercel

### Steps:
1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub
3. Import your repository
4. Vercel will auto-detect Node.js
5. Deploy!

## Option 4: Heroku

### Steps:
1. Install Heroku CLI
2. Login: `heroku login`
3. Create app: `heroku create your-app-name`
4. Deploy: `git push heroku main`
5. Open: `heroku open`

## Important Notes:

- The SQLite database will reset on each deployment (data is not persistent)
- For production, consider using PostgreSQL or MongoDB
- Set strong JWT secrets in environment variables
- Enable HTTPS (most platforms do this automatically)

## Access URLs:
- Main: `https://your-domain.com`
- Instructor: `https://your-domain.com/instructor`
- Student: `https://your-domain.com/student`
