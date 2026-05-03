# NextRole — AI-Powered Job Application Platform

## Problem
Job hunting is fragmented and time-consuming — searching across multiple platforms, manually evaluating fit, and tracking applications through email threads and spreadsheets.

## Solution
An end-to-end job application platform that uses AI to automatically discover matching jobs, evaluate them against your profile, and manage the entire process from discovery to final status.

## Features
- **Job Discovery** — Scrape listings from LinkedIn, Indeed, and other boards based on configurable search criteria
- **AI Scoring** — Claude evaluates each job against your professional profile and scores fit with detailed reasoning
- **Company Enrichment** — Auto-fetch company news and Glassdoor ratings to enrich job evaluations
- **Email Monitoring** — Scan Gmail for application updates (interviews, rejections, offers) and auto-update job status
- **Application Dashboard** — Track every application from discovery through interviews to final outcome
- **Discovery Runs** — Run searches on demand, monitor progress in real-time, and review results per run

## Planned
- **User Profile Management** — UI for creating and editing your professional profile (skills, experience, preferences) used by AI scoring
- **Job Status State Machine** — Defined lifecycle: Discovered → Applied → Interviewing → Offer / Rejected / Withdrawn
- **Notifications** — Alert the user when high-scoring jobs are found or application status changes (email/push)

## Out of Scope
- **Auto-Apply** — Automated job applications on external platforms (too unreliable across different sites)

## Known Issues
- **Deduplication bug** — Cross-run duplicate detection needs fixing

