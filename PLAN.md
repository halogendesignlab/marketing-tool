# Halogen Marketing Platform — Development Plan

## What This Tool Does
A multi-client marketing automation platform that:
1. Uses Claude AI to generate social media posts, blog articles, and Google Business Profile content
2. Emails clients to review and approve generated content
3. Publishes approved content to Instagram, Facebook, LinkedIn, GBP, and Webflow blogs
4. (Future) Monitors reviews, tracks SEO rankings, checks directory listings, generates monthly reports

---

## API Keys & Integrations

| Service | Purpose | Key Status |
|---|---|---|
| Anthropic | AI content generation | ✅ Have key |
| Publer | Social media publishing | ✅ Have key |
| Resend | Email notifications | ✅ Have key |
| Webflow | Blog publishing | ❌ Need account |
| Google (GBP + Drive) | Business Profile + asset photos | ❌ Need OAuth setup |
| DataForSEO | Reviews, SERP, directory monitoring | ❌ Need account |

---

## Development Phases

### Phase 1 — Core Loop (current focus)
**Goal:** Generate content for Moorhouse → email notification → approve in portal → publish via Publer

- [x] Backend API running locally
- [x] Frontend running locally (login, dashboard, approvals, reviews)
- [x] Admin account created
- [ ] Add API keys to `.env` file (Anthropic, Publer, Resend)
- [ ] Add Moorhouse Commercial as a client in the database
- [ ] Trigger test content generation run
- [ ] Verify content appears in Approvals page
- [ ] Approve content and verify it publishes to Publer
- [ ] Verify email notification is sent

### Phase 2 — Assets Page
**Goal:** Build the missing Assets approval page (images synced from Google Drive)

- [ ] Create `/assets` frontend page (mirrors Approvals layout)
- [ ] Test assets flow end-to-end

### Phase 3 — Webflow Blog Publishing
**Goal:** Wire up blog post generation and publishing to Webflow CMS

- [ ] Get Webflow API token + site/collection IDs for Moorhouse
- [ ] Test blog post generation
- [ ] Verify published to Webflow

### Phase 4 — Google Integrations
**Goal:** Connect Google Drive for assets, GBP for posting and insights

- [ ] Set up Google Service Account (Drive asset sync)
- [ ] Set up Google OAuth (GBP posting)
- [ ] Test GBP post publishing
- [ ] Test Drive asset download

### Phase 5 — DataForSEO (Reviews, SERP, Directories)
**Goal:** Implement the three monitoring features that are currently stubs

- [ ] Get DataForSEO account
- [ ] Implement review fetching and response drafting
- [ ] Implement SERP geo-grid tracking
- [ ] Implement directory NAP consistency checks

### Phase 6 — Reports Page
**Goal:** Build monthly report UI and wire up report generation

- [ ] Build reports frontend page
- [ ] Wire up report data from all sources
- [ ] Test report generation for Moorhouse

### Deploy
**Goal:** Push working platform to DigitalOcean VPS for Moorhouse to use

- [ ] Review and harden deploy scripts
- [ ] Set up managed PostgreSQL database
- [ ] Deploy to VPS
- [ ] Run onboarding for Moorhouse Commercial
- [ ] Hand off login credentials to client

---

## Current Local Setup

- **Backend:** http://127.0.0.1:8000 (FastAPI)
- **Frontend:** http://localhost:3000 (Next.js)
- **Database:** SQLite (local only — PostgreSQL used in production)
- **Admin login:** caleb@halogendesignlab.com / admin1234

## Local → Production Workflow
```
Build & test locally → Push to GitHub → Pull onto VPS → Go live
```

---

## Known Issues to Fix Before Deploy
1. Assets page missing (Phase 2)
2. Deploy scripts need a generated Postgres password (not hardcoded)
3. Frontend needs its own systemd service for auto-restart
4. No database backups configured
5. Scheduler silently swallows errors — needs alerting
