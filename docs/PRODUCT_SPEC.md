# CallPulse — Product Specification

## The Problem

Sales managers with teams of 4+ SDRs receive hundreds of call recordings per week. They can't listen to every call, so performance issues go undetected, feedback is inconsistent, and there's no structured way to track improvement over time. When underperformance continues, managers lack the data to make confident decisions.

## The Solution

CallPulse is an internal tool that lets sales managers upload call recordings or transcripts, get AI-powered analysis with quantitative scores, receive structured coaching feedback, and track SDR performance week-over-week — all without listening to a single call.

---

## Core Concepts

### Multi-Tenancy Model

```
Company (e.g., "Acme Corp")
  └── Users
        ├── Admin — manages company settings, adds managers
        ├── Manager — uploads calls, views all SDR data, runs reports
        └── SDR — views own calls, scores, and coaching feedback
```

- A **Company** is the top-level tenant. Each company has isolated data.
- **Admins** can manage company settings and invite users.
- **Managers** see all SDRs in their company, upload calls, and generate reports.
- **SDRs** see only their own data — calls, scores, feedback, and improvement trends.

### The Weekly Cycle

CallPulse is built around a weekly rhythm:

1. **Upload** — Manager uploads that week's call recordings or transcripts
2. **Analyze** — AI processes each call and generates scores + feedback
3. **Review** — Manager reviews the weekly report and SDR dashboards
4. **Coach** — SDRs receive actionable coaching items to work on
5. **Compare** — Next week, the cycle repeats and WoW comparison shows progress

---

## Scoring Framework

Every call is scored on 6 dimensions (1–10 scale):

| Dimension | What It Measures |
|-----------|-----------------|
| **Opening & Hook** | Did the SDR capture attention in the first 30 seconds? |
| **Discovery & Qualification** | Did they ask the right questions to qualify the prospect? |
| **Value Proposition** | Did they clearly articulate the product's value? |
| **Objection Handling** | How well did they address pushback or concerns? |
| **Closing Technique** | Did they drive toward a next step or commitment? |
| **Tone & Rapport** | Were they professional, warm, and confident? |

**Overall Score** = weighted average (all equal weight by default, configurable later).

Each dimension also gets:
- A short **justification** (why this score)
- **Specific quotes** from the transcript as evidence
- **Coaching suggestion** (what to do differently)

---

## Features — MVP

### 1. Call Upload & Processing

- Upload audio files (MP3, WAV, M4A) — auto-transcribed via Deepgram
- Upload text transcripts directly (TXT, paste)
- Assign each call to an SDR and tag with the week
- Batch upload support (multiple files at once)
- Processing status tracking (uploading → transcribing → analyzing → complete)

### 2. AI Call Analysis

- Powered by Claude API (claude-sonnet-4-5-20250929)
- Structured JSON output with scores, justifications, quotes, and coaching
- Each call gets a full analysis card showing all 6 dimensions
- Calls flagged as "Needs Attention" if overall score < 5
- Calls flagged as "Great Example" if overall score > 8

### 3. SDR Dashboard

- Per-SDR view showing:
  - Current week's calls and scores
  - Score trend chart (sparkline per dimension over weeks)
  - Strengths (consistently high dimensions)
  - Areas for improvement (consistently low dimensions)
  - Active coaching items

### 4. Weekly Report

- Auto-generated summary for the week per SDR:
  - Number of calls analyzed
  - Average scores per dimension
  - Best call and worst call
  - Top coaching priorities
- Company-wide weekly summary:
  - Team average scores
  - SDR leaderboard (ranked by overall score)
  - Team-wide patterns (e.g., "3 of 4 SDRs struggle with closing")

### 5. Week-over-Week Comparison

- Side-by-side score comparison: this week vs. last week
- Delta indicators (↑ improved, ↓ declined, → stable)
- Trend visualization over 4–8 weeks
- "Coaching impact" metric — did scores improve on dimensions that had coaching items?
- Stagnation alerts — if an SDR shows no improvement over 3+ weeks

### 6. Coaching Playbook

- Each analysis generates specific, actionable coaching items
- Items are tracked: Open → In Progress → Completed
- SDRs can see their own coaching items
- Managers can add manual coaching notes
- Items carry forward until addressed

### 7. Team Management

- Invite users by email (Supabase Auth with magic links)
- Role assignment: Admin, Manager, SDR
- SDR profiles with metadata (name, email, start date)
- Deactivate (not delete) SDRs who leave

---

## Data Model

### Tables

**companies**
- id (uuid, PK)
- name (text)
- created_at (timestamp)

**profiles** (extends Supabase auth.users)
- id (uuid, PK, references auth.users)
- company_id (uuid, FK → companies)
- full_name (text)
- role (enum: admin, manager, sdr)
- is_active (boolean, default true)
- created_at (timestamp)

**calls**
- id (uuid, PK)
- company_id (uuid, FK → companies)
- sdr_id (uuid, FK → profiles)
- uploaded_by (uuid, FK → profiles)
- file_url (text, nullable — for audio uploads)
- transcript (text)
- call_date (date)
- week_number (integer)
- year (integer)
- duration_seconds (integer, nullable)
- prospect_name (text, nullable)
- status (enum: uploading, transcribing, analyzing, completed, failed)
- created_at (timestamp)

**call_analyses**
- id (uuid, PK)
- call_id (uuid, FK → calls, unique)
- overall_score (decimal)
- opening_score (decimal) + opening_justification (text) + opening_quotes (text[])
- discovery_score (decimal) + discovery_justification (text) + discovery_quotes (text[])
- value_prop_score (decimal) + value_prop_justification (text) + value_prop_quotes (text[])
- objection_score (decimal) + objection_justification (text) + objection_quotes (text[])
- closing_score (decimal) + closing_justification (text) + closing_quotes (text[])
- tone_score (decimal) + tone_justification (text) + tone_quotes (text[])
- strengths (text[])
- weaknesses (text[])
- summary (text)
- created_at (timestamp)

**coaching_items**
- id (uuid, PK)
- call_analysis_id (uuid, FK → call_analyses)
- sdr_id (uuid, FK → profiles)
- company_id (uuid, FK → companies)
- dimension (text — which scoring dimension)
- action_item (text)
- status (enum: open, in_progress, completed)
- created_at (timestamp)
- completed_at (timestamp, nullable)

**weekly_reports**
- id (uuid, PK)
- company_id (uuid, FK → companies)
- sdr_id (uuid, FK → profiles)
- week_number (integer)
- year (integer)
- calls_analyzed (integer)
- avg_scores (jsonb — {opening: 7.2, discovery: 6.5, ...})
- best_call_id (uuid, FK → calls)
- worst_call_id (uuid, FK → calls)
- summary (text)
- comparison_with_previous (jsonb — {opening: +0.5, discovery: -0.3, ...})
- coaching_impact (jsonb — tracks improvement on coached dimensions)
- created_at (timestamp)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Routing | React Router v6 |
| State | TanStack Query (server state) + Zustand (client state) |
| Backend/DB | Supabase (PostgreSQL + Auth + Storage + Edge Functions) |
| AI Analysis | Claude API (Anthropic) |
| Transcription | Deepgram API (for audio files) |
| Charts | Recharts |
| Deployment | Vercel (frontend) + Supabase Cloud (backend) |

---

## Pages & Navigation

### Sidebar Navigation

```
📊 Dashboard
📞 Calls
  └── Upload
  └── All Calls
👥 Team
  └── SDR List
  └── [Individual SDR]
📈 Reports
  └── Weekly Report
  └── WoW Comparison
  └── Leaderboard
⚙️ Settings
  └── Company
  └── Team Management
```

### Page Descriptions

**Dashboard** — At-a-glance view: team average score this week, WoW trend, calls analyzed, SDRs needing attention, top performer.

**Upload** — Drag-and-drop zone for audio/transcript files. Select SDR, enter call date. Batch upload support. Progress indicators.

**All Calls** — Filterable table: SDR, date, score, status. Click to view call detail.

**Call Detail** — Full transcript on the left, analysis card on the right. Scores with color coding (red/yellow/green). Coaching items at the bottom.

**SDR Profile** — Individual SDR view: score trends over time, recent calls, coaching backlog, strengths/weaknesses radar chart.

**Weekly Report** — Per-SDR or team-wide. Scores, best/worst calls, coaching priorities. Printable.

**WoW Comparison** — This week vs last week, with deltas. 4-week and 8-week trend lines. Coaching impact analysis.

**Leaderboard** — All SDRs ranked by overall score. Filterable by dimension. Week selector.

---

## AI Analysis Prompt Design

The Claude API call for each transcript uses a structured prompt that returns JSON:

```
You are an expert sales coach analyzing a cold call transcript.

Score this call on 6 dimensions (1-10 scale):
1. Opening & Hook
2. Discovery & Qualification
3. Value Proposition
4. Objection Handling
5. Closing Technique
6. Tone & Rapport

For each dimension, provide:
- score (1-10)
- justification (2-3 sentences explaining the score)
- quotes (1-2 direct quotes from the transcript as evidence)
- coaching_suggestion (specific, actionable advice)

Also provide:
- overall_score (average of all dimensions)
- strengths (top 2-3 things the SDR did well)
- weaknesses (top 2-3 areas for improvement)
- summary (2-3 sentence overall assessment)

Return valid JSON only.
```

---

## Security & Access Control

- **Row Level Security (RLS)** on all tables — users only see their company's data
- **Role-based access** — SDRs see only their own calls/scores; Managers see all SDRs in company
- **Supabase Auth** — Email/password + magic link sign-in
- **API keys** — Claude and Deepgram keys stored as Supabase secrets (Edge Functions only)
- **File storage** — Audio files in Supabase Storage with company-scoped buckets

---

## Future Enhancements (Post-MVP)

- Real-time call monitoring (live transcription)
- CRM integration (HubSpot, Salesforce) to pull call outcomes
- Custom scoring frameworks per company
- AI-generated role-play scripts based on weak areas
- Slack/email notifications for weekly reports
- Call library — save great calls as training examples
- Comparison with industry benchmarks
- Export reports as PDF
