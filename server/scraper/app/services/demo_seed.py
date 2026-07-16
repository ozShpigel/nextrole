"""Fictional job postings for the public demo's vector search pool.

The demo's Discovery data is deliberately fictional, and scraping real boards
from a datacenter IP is unreliable — so the demo search pool is seeded instead:
`python -m app.cli seed-demo-jobs` embeds these postings once (one OpenAI call)
and inserts them as DiscoveredJob docs. On every demo web-service startup
(DEMO_MODE=true), `refresh_seed_timestamps` bumps their `discovered_at` so they
always sit inside the Search page's days-back window and never TTL out —
visitors get deterministic, populated search results with zero scraping.

The postings are written for the seeded demo profile (senior full-stack
engineer — TypeScript/React/Node, Python, Java/Spring, AWS, PostgreSQL,
e-commerce + healthtech, values sustainable pace and mentoring): a spread of
strong matches, partial matches, and clear mismatches so the advisor has real
ranking decisions to show off — including topically-strong postings with
culture red flags. Companies and URLs are fictional.
"""
import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import Settings
from app.models.discovered_job import DiscoveredJob
from app.services import embeddings

logger = logging.getLogger(__name__)

# Marker field on seeded docs — lets seeding stay idempotent and the startup
# refresh cheap, without ever touching genuinely scraped jobs.
SEED_MARKER = "demo_seed"
SEED_RUN_ID = "demo-seed"


def _p(title: str, company: str, location: str, level: str | None,
       remote: bool | None, slug: str, description: str) -> dict:
    return {
        "title": title,
        "company": company,
        "location": location,
        "job_level": level,
        "is_remote": remote,
        "job_url": f"https://careers.demo-nextrole.example/{slug}",
        "description": description.strip(),
    }


POSTINGS: list[dict] = [
    # ---- Strong matches: senior full-stack / backend, TS/Node/React/AWS ----
    _p("Senior Full Stack Engineer", "Cartwheel Commerce", "Tel Aviv, Israel", "mid-senior level", False, "cartwheel-senior-fullstack",
       """Cartwheel builds checkout and post-purchase infrastructure for mid-size e-commerce brands.
You'll own features end to end across a React + Node.js (TypeScript) stack on AWS, from design through production.
What you'll do: design REST APIs and React flows for our payments dashboard; improve reliability of order pipelines processing hundreds of thousands of orders a month; write design docs and lead reviews; mentor two mid-level engineers.
Requirements: 6+ years building web applications; strong TypeScript, React, and Node.js; PostgreSQL and Redis in production; AWS and CI/CD (GitHub Actions).
We work at a sustainable pace — no on-call heroics; quality gates and observability are part of the definition of done."""),
    _p("Senior Backend Engineer, Payments", "Medley Health", "Ramat Gan, Israel", "mid-senior level", True, "medley-backend-payments",
       """Medley Health is a healthtech platform connecting clinics with patients. Our payments team owns billing, claims, and payouts.
You'll build Node.js (TypeScript) services with PostgreSQL and Redis on AWS, integrate with payment providers, and drive our contract-testing practice.
Requirements: 5+ years backend experience; strong API design; production experience with queues and idempotent processing; testing culture.
Nice to have: healthcare or fintech background; Python tooling.
We invest in documentation, blameless postmortems, and career growth — engineers here mentor and get mentored."""),
    _p("Full Stack Tech Lead", "Orchard & Vine", "Herzliya, Israel", "mid-senior level", False, "orchard-fullstack-lead",
       """Orchard & Vine runs a marketplace for specialty food producers. We're hiring a hands-on tech lead for the storefront team (4 engineers).
Stack: React, Node.js, TypeScript, PostgreSQL, AWS (ECS, RDS). You'll split time between coding, design reviews, and growing the team — we promote from within and expect leads to mentor.
Requirements: 7+ years full stack; led projects end to end; strong written communication; experience breaking ambiguous product asks into shippable milestones.
We ship weekly, keep scope honest, and protect focus time (no-meeting Wednesdays)."""),
    _p("Senior Software Engineer, Patient Experience", "Northlight Care", "Tel Aviv, Israel", "mid-senior level", True, "northlight-patient-exp",
       """Northlight Care builds scheduling and intake software for outpatient clinics.
You'll own patient-facing features across React and Node.js, with Python services for integrations (HL7/FHIR). PostgreSQL, Redis, AWS.
Requirements: 5+ years; strong product sense; experience improving API latency and reliability; test automation.
Why here: stable, profitable company; 4.5 Glassdoor work-life score; engineers write the docs and run the demos. Mentorship is a first-class expectation of senior folks."""),
    _p("Senior Backend Engineer (Node.js)", "Parcelly", "Remote (Israel)", "mid-senior level", True, "parcelly-backend-node",
       """Parcelly is a shipping-rates and labels API for e-commerce platforms. Fully remote, async-first.
You'll design and scale Node.js/TypeScript services (PostgreSQL, Redis, SQS) handling carrier integrations, and own reliability (SLOs, tracing, alerting).
Requirements: 5+ years backend; deep REST API design experience; production debugging chops; clear written communication (we run on RFCs).
We measure outcomes, not hours; sustainable pace is in the handbook."""),

    # ---- Good-but-partial matches ----
    _p("Backend Engineer, Java/Spring", "Ledgerline", "Tel Aviv, Israel", "mid-senior level", False, "ledgerline-java-spring",
       """Ledgerline builds reconciliation software for finance teams. Java 21, Spring Boot, PostgreSQL, AWS.
You'll build integration pipelines and internal APIs, with strong emphasis on correctness and auditability.
Requirements: 4+ years Java/Spring; SQL fluency; testing discipline. Nice to have: TypeScript for internal tools.
Structured, calm environment; code review culture; flexible hybrid schedule."""),
    _p("Software Engineer, Growth", "Bloomcart", "Ramat Gan, Israel", "associate", False, "bloomcart-growth",
       """Bloomcart is an e-commerce personalization startup. The growth team ships experiments across a React/Node stack.
You'll build A/B testing infrastructure, landing flows, and analytics events; 2-4 years experience expected.
Fast feedback loops, small scope, lots of product contact. Great fit for an engineer growing toward senior."""),
    _p("Senior Python Engineer, Integrations", "Chartwell Health Systems", "Herzliya, Israel", "mid-senior level", True, "chartwell-python-integrations",
       """Chartwell connects hospital EHRs with insurers. You'll own Python integration services (FastAPI, PostgreSQL, AWS Lambda), parsing and validating clinical data feeds.
Requirements: 5+ years, strong Python, API design, data-quality mindset. Node/TypeScript useful for shared tooling.
Health-tech domain experience is a plus; we document heavily and favor boring, reliable technology."""),
    _p("Staff Engineer, Platform", "Quantararium", "Tel Aviv, Israel", "director", False, "quantararium-staff-platform",
       """Quantararium (Series D, 400 engineers) seeks a Staff Engineer for our developer platform group.
You'll set multi-team technical direction for build/deploy infrastructure, drive org-wide RFCs, and coach senior engineers. Kubernetes, Go, AWS at scale.
Requirements: 10+ years; prior Staff/Principal scope; platform or infra specialization; Go or Rust systems experience."""),
    _p("Full Stack Engineer", "Kibbutz Digital Collective", "Remote (Israel)", "associate", True, "kdc-fullstack",
       """Small agency building web apps for cooperatives and nonprofits. React, Node, PostgreSQL.
You'll rotate across 2-3 client projects, own features end to end, and talk to users directly.
Requirements: 3+ years full stack; self-directed; comfortable with ambiguity. Four-day work week, modest pay, high autonomy."""),

    # ---- Topically strong but culture red flags (advisor material) ----
    _p("Senior Full Stack Engineer", "BlitzBasket", "Tel Aviv, Israel", "mid-senior level", False, "blitzbasket-senior-fullstack",
       """BlitzBasket is the fastest-growing quick-commerce app in the region. React/Node/TypeScript/AWS at serious scale.
We move FAST. You'll ship daily, wear many hats, and do whatever it takes — nights and weekends during launches are part of the ride. Unlimited energy drinks, catered dinners (you'll be here for them), equity that could be life-changing.
Requirements: 5+ years full stack; thrives under pressure; "sustainable pace" isn't in our vocabulary — winning is."""),
    _p("Senior Backend Engineer", "GrindStack Technologies", "Bnei Brak, Israel", "mid-senior level", False, "grindstack-backend",
       """GrindStack builds trading tooling. Node.js/TypeScript, PostgreSQL, AWS — a stack you'll feel at home in.
We're a hardcore engineering culture: two-person teams own huge surfaces, on-call is weekly, and we ship 7 days a week. Top-of-market pay for top-of-market intensity.
Requirements: 6+ years backend; high ownership; availability matters — markets don't sleep."""),

    # ---- Clear mismatches (role family / stack) ----
    _p("Senior iOS Engineer", "Pocketpath", "Tel Aviv, Israel", "mid-senior level", False, "pocketpath-ios",
       """Pocketpath builds a consumer travel app. Swift, SwiftUI, Combine; 5+ years native iOS required.
You'll own the trip-planning experience end to end with our design team."""),
    _p("Machine Learning Engineer, Ranking", "Feedforward AI", "Tel Aviv, Israel", "mid-senior level", True, "feedforward-ml-ranking",
       """Feedforward builds recommendation systems. You'll train and serve ranking models (PyTorch, Python, Spark), own offline eval and online experiments.
Requirements: 4+ years ML engineering; strong math background; production model serving."""),
    _p("Senior DevOps Engineer", "Cloudspan Systems", "Herzliya, Israel", "mid-senior level", True, "cloudspan-devops",
       """Cloudspan provides managed Kubernetes for enterprises. You'll build Terraform modules, operators, and CI/CD for customer clusters.
Requirements: 5+ years infra; deep Kubernetes; Go scripting; on-call rotation."""),
    _p("Embedded Software Engineer", "Voltaic Motors", "Rehovot, Israel", "mid-senior level", False, "voltaic-embedded",
       """Voltaic builds battery management systems for e-mobility. C/C++ on real-time OS, CAN bus, hardware-in-the-loop testing.
Requirements: 5+ years embedded C/C++; automotive or safety-critical background preferred."""),
    _p("Data Analyst, Marketplace", "Souq Analytics", "Tel Aviv, Israel", "associate", False, "souq-data-analyst",
       """Souq Analytics helps marketplaces price inventory. You'll build dashboards (SQL, Looker, Python notebooks) and partner with commercial teams.
Requirements: 2+ years analytics; strong SQL; storytelling with data."""),
    _p("Junior Frontend Developer", "Petal & Stem", "Ramat Gan, Israel", "entry level", False, "petal-junior-frontend",
       """Petal & Stem is a flower-delivery startup. You'll build React components with our senior engineers, fix bugs, and grow fast.
Requirements: 0-2 years; JavaScript/React basics; hunger to learn. Great first or second job."""),
    _p("Engineering Manager, Consumer Web", "Halcyon Media", "Tel Aviv, Israel", "director", False, "halcyon-em-consumer",
       """Halcyon Media runs entertainment properties reaching millions. You'll manage two web teams (10 engineers), own delivery and careers, and partner with product.
Requirements: 3+ years engineering management; prior senior IC experience in web stacks; strong hiring track record."""),
    _p("Senior Solutions Architect (Pre-sales)", "Nimbus Vault", "Remote (EMEA)", "mid-senior level", True, "nimbusvault-solutions-architect",
       """Nimbus Vault sells data-protection software. You'll run technical discovery, demos, and POCs with enterprise customers; ~30% travel.
Requirements: 5+ years customer-facing engineering; storage/backup domain knowledge; excellent presentation skills."""),

    # ---- Wildcard mid matches to fill out rankings ----
    _p("Senior Software Engineer, Internal Tools", "Grove Logistics", "Petah Tikva, Israel", "mid-senior level", False, "grove-internal-tools",
       """Grove Logistics moves produce from farms to retailers. You'll build internal ops tools (React, Node, PostgreSQL) used daily by 200 dispatchers, and integrate with our routing engine (Python).
Requirements: 5+ years full stack; pragmatism; user empathy for non-technical operators. Steady, family-friendly culture."""),
    _p("Backend Engineer, API Platform", "Tessello", "Tel Aviv, Israel", "mid-senior level", True, "tessello-api-platform",
       """Tessello provides e-signature APIs. You'll evolve our public REST API (Node.js/TypeScript), rate limiting, webhooks, and SDK generation; PostgreSQL + Redis + AWS.
Requirements: 4+ years backend; API-first mindset; strong docs. We value deep work and keep meetings to mornings."""),
    _p("Senior Software Engineer (Java)", "Beacon Claims", "Haifa, Israel", "mid-senior level", True, "beacon-claims-java",
       """Beacon Claims automates insurance claims for healthcare providers. Java/Spring Boot core with a growing TypeScript edge; PostgreSQL; AWS.
Requirements: 5+ years JVM backend; healthcare data (X12/FHIR) a plus; careful, test-driven style.
Hybrid or remote within Israel; unusually good documentation culture."""),
    _p("Full Stack Engineer, Checkout", "Marketfair", "Tel Aviv, Israel", "mid-senior level", False, "marketfair-checkout",
       """Marketfair powers online stores for retail chains. The checkout team owns cart, payments UI, and order submission — React + Node + PostgreSQL on AWS.
Requirements: 4+ years full stack; payments or e-commerce experience preferred; strong debugging under load (peak-season traffic).
Sane on-call (business hours), real test coverage, quarterly hack weeks."""),
    _p("Senior TypeScript Engineer, Design Systems", "Lattice & Loom", "Remote (Israel)", "mid-senior level", True, "lattice-design-systems",
       """Lattice & Loom builds a B2B furniture configurator. You'll own our React component library and design tokens, partnering with design; strong TypeScript rigor expected.
Requirements: 5+ years frontend-leaning full stack; accessibility knowledge; API design for component contracts."""),
    _p("Python Backend Engineer, Pharmacy", "DoseWise", "Ramat Gan, Israel", "mid-senior level", False, "dosewise-python-pharmacy",
       """DoseWise builds medication-management software for pharmacies. Python (Django/FastAPI), PostgreSQL, AWS; React frontend maintained by the same team.
Requirements: 4+ years Python backend; interest in owning features through the UI; healthcare compliance mindset (we'll teach the specifics)."""),
]


def build_seed_docs(vectors: list[list[float] | None]) -> list[dict]:
    """Pair POSTINGS with their vectors into insert-ready DiscoveredJob dicts."""
    now = datetime.now(timezone.utc)
    docs = []
    for posting, vector in zip(POSTINGS, vectors):
        job = DiscoveredJob(
            run_id=SEED_RUN_ID,
            criteria_id=SEED_RUN_ID,
            site="demo",
            date_posted=now.date().isoformat(),
            job_embedding=vector,
            embedding_model=embeddings.EMBEDDING_MODEL if vector else None,
            **posting,
        )
        doc = job.model_dump()
        doc[SEED_MARKER] = True
        doc["discovered_at"] = now
        docs.append(doc)
    return docs


async def seed_demo_jobs(db: AsyncIOMotorDatabase, settings: Settings) -> dict:
    """Replace the seeded demo pool: embed POSTINGS and insert them fresh.

    Idempotent — previously seeded docs (SEED_MARKER) are deleted first;
    genuinely scraped jobs are never touched. One OpenAI embeddings call.
    """
    texts = [embeddings.build_job_embedding_text(p) for p in POSTINGS]
    vectors = await embeddings.embed_texts(settings, texts)
    embedded = sum(1 for v in vectors if v is not None)
    if embedded == 0:
        raise RuntimeError("No postings could be embedded — check OPENAI_API_KEY")

    removed = await db.discovered_jobs.delete_many({SEED_MARKER: True})
    docs = build_seed_docs(vectors)
    await db.discovered_jobs.insert_many(docs)
    logger.info(
        "Seeded %d demo jobs (%d embedded), replaced %d previously seeded",
        len(docs), embedded, removed.deleted_count,
    )
    return {"seeded": len(docs), "embedded": embedded, "replaced": removed.deleted_count}


async def refresh_seed_timestamps(db: AsyncIOMotorDatabase) -> int:
    """Bump seeded jobs' discovered_at to now.

    Called on demo web-service startup: free-tier cold starts happen whenever a
    visitor arrives, so the seeds re-enter the Search page's days-back window
    exactly when someone is looking, and the TTL index never purges them.
    No-op (0) when nothing was seeded.
    """
    result = await db.discovered_jobs.update_many(
        {SEED_MARKER: True},
        {"$set": {"discovered_at": datetime.now(timezone.utc)}},
    )
    if result.modified_count:
        logger.info("Refreshed discovered_at on %d seeded demo jobs", result.modified_count)
    return result.modified_count
