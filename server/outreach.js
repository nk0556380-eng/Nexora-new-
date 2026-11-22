'use strict';

/**
 * Instagram outreach assistant.
 *
 * Two layers, deliberately separated:
 *   1. auditLead()  — deterministic, rule-based scoring from facts an operator
 *                     recorded after looking at the profile. Same input always
 *                     produces the same problems and score.
 *   2. runAudit()   — optional AI pass that turns those facts into a short
 *                     summary and DM drafts. The AI never invents metrics; the
 *                     prompt only contains measured values and the rule-based
 *                     findings.
 *
 * Nothing here sends a message. Drafts are copied by a human.
 */

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const AI_TIMEOUT_MS = 20000;
const HEALTHY_ENGAGEMENT_PERCENT = 1;
const STALE_POST_DAYS = { high: 90, medium: 30, low: 14 };

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const SYSTEM_PROMPT = [
  'You audit Instagram business profiles for an Indian B2B outreach agency.',
  'Use only the facts provided. Never invent followers, engagement, campaigns,',
  'clients or results. Write short, specific, non-spammy direct messages.'
].join(' ');

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Whole days between a YYYY-MM-DD date and now, or null when unknown. */
function daysSince(dateString, now) {
  if (!dateString) return null;
  const parsed = Date.parse(String(dateString) + 'T00:00:00Z');
  if (Number.isNaN(parsed)) return null;
  const reference = now instanceof Date ? now : new Date(now);
  const today = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  return Math.floor((today - parsed) / 86400000);
}

/** Engagement as a percentage, rounded to 2 decimals; null when followers are unknown. */
function engagementRate(lead) {
  const followers = toNumber(lead.followers);
  if (followers <= 0) return null;
  const rate = (toNumber(lead.avg_likes) / followers) * 100;
  return Math.round(rate * 100) / 100;
}

/** Adds a finding and returns its score penalty so callers can accumulate it. */
function addProblem(problems, weight, problem) {
  problems.push(problem);
  return weight;
}

/**
 * Rule-based health score. Lower is worse, which makes a useful prospect sort:
 * lots of fixable gaps are exactly who this list is for.
 */
function auditLead(lead, now = new Date()) {
  const followers = toNumber(lead.followers);
  const posts = toNumber(lead.post_count);
  const likes = toNumber(lead.avg_likes);
  const highlights = toNumber(lead.highlight_count);
  const bio = String(lead.bio || '').trim();
  const reelsShare = lead.reels_share === null || lead.reels_share === undefined
    ? null
    : toNumber(lead.reels_share);
  const gap = daysSince(lead.last_post_on, now);
  const rate = engagementRate(lead);
  const problems = [];
  let penalty = 0;

  if (gap !== null) {
    if (gap >= STALE_POST_DAYS.high) {
      penalty += addProblem(problems, 30, {
        code: 'posting_gap',
        severity: 'high',
        title: 'Profile has gone quiet',
        detail: `Last post was ${gap} days ago.`
      });
    } else if (gap >= STALE_POST_DAYS.medium) {
      penalty += addProblem(problems, 18, {
        code: 'posting_gap',
        severity: 'medium',
        title: 'Posting has slowed down',
        detail: `Last post was ${gap} days ago.`
      });
    } else if (gap >= STALE_POST_DAYS.low) {
      penalty += addProblem(problems, 8, {
        code: 'posting_gap',
        severity: 'low',
        title: 'Posting cadence is uneven',
        detail: `Last post was ${gap} days ago.`
      });
    }
  }

  if (followers > 0 && followers < 500) {
    penalty += addProblem(problems, 10, {
      code: 'small_audience',
      severity: 'medium',
      title: 'Audience is still small',
      detail: `${followers} followers — reach is the first constraint, not content polish.`
    });
  } else if (followers >= 500 && followers < 2000) {
    penalty += addProblem(problems, 5, {
      code: 'small_audience',
      severity: 'low',
      title: 'Audience is below the usual buyer threshold',
      detail: `${followers} followers.`
    });
  }

  if (rate !== null && rate < 0.5) {
    penalty += addProblem(problems, 20, {
      code: 'low_engagement',
      severity: 'high',
      title: 'Engagement is far below a healthy account',
      detail: `${rate}% (${likes} average likes on ${followers} followers; healthy niche accounts run above ${HEALTHY_ENGAGEMENT_PERCENT}%).`
    });
  } else if (rate !== null && rate < 1) {
    penalty += addProblem(problems, 12, {
      code: 'low_engagement',
      severity: 'medium',
      title: 'Engagement is weak',
      detail: `${rate}% (${likes} average likes on ${followers} followers).`
    });
  } else if (rate !== null && rate < 2) {
    penalty += addProblem(problems, 6, {
      code: 'low_engagement',
      severity: 'low',
      title: 'Engagement has room to grow',
      detail: `${rate}% (${likes} average likes on ${followers} followers).`
    });
  }

  if (!lead.has_link) {
    penalty += addProblem(problems, 12, {
      code: 'missing_link',
      severity: 'medium',
      title: 'No link in bio',
      detail: 'Interested visitors have nowhere to go next.'
    });
  }

  if (!lead.has_cta) {
    penalty += addProblem(problems, 8, {
      code: 'missing_cta',
      severity: 'low',
      title: 'Bio has no next step',
      detail: 'No clear call to action such as "DM us" or "book a call".'
    });
  }

  if (bio.length < 60) {
    penalty += addProblem(problems, 8, {
      code: 'thin_bio',
      severity: 'medium',
      title: 'Bio does not explain the offer',
      detail: `Bio is ${bio.length} characters — too short to say who it is for and what it delivers.`
    });
  }

  if (highlights === 0) {
    penalty += addProblem(problems, 5, {
      code: 'no_highlights',
      severity: 'low',
      title: 'No highlights for proof or FAQs',
      detail: 'No saved stories, so results, process and pricing questions are invisible.'
    });
  }

  if (reelsShare !== null && reelsShare < 20) {
    penalty += addProblem(problems, 6, {
      code: 'low_reels_share',
      severity: 'low',
      title: 'Grid is almost all static posts',
      detail: `Only ${reelsShare}% of recent posts are reels — reach is capped by format.`
    });
  }

  if (posts < 20) {
    penalty += addProblem(problems, 8, {
      code: 'thin_grid',
      severity: 'medium',
      title: 'Too few posts to build trust',
      detail: `${posts} posts in total.`
    });
  }

  problems.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    score: clamp(100 - penalty, 0, 100),
    problems,
    engagementRate: rate,
    daysSinceLastPost: gap
  };
}

function fallbackSummary(lead, problems) {
  if (!problems.length) {
    return `No obvious gaps in the recorded data for ${lead.agency}. Verify the profile by hand before sending anything.`;
  }
  const top = problems.slice(0, 2).map((problem) => problem.title.toLowerCase());
  return `${lead.agency} (@${lead.handle}) has ${problems.length} fixable gap(s), led by ${top.join(' and ')}. ` +
    'One specific observation is enough to start the conversation.';
}

function fallbackDraft(lead, problems) {
  const first = problems[0];
  const agency = lead.agency;
  if (!first) {
    return `Hi ${agency} — I had a quick look at @${lead.handle}. What is the main channel bringing you enquiries right now? ` +
      'I work with agencies on exactly that and would happily share one idea.';
  }
  return `Hi ${agency} — I looked at @${lead.handle} and noticed ${first.detail.toLowerCase()} ` +
    'That is usually a quick fix. Want me to send the two changes I would make first?';
}

function buildAuditPrompt(lead, problems) {
  const facts = {
    handle: lead.handle,
    agency: lead.agency,
    city: lead.city || null,
    niche: lead.niche || null,
    followers: toNumber(lead.followers),
    posts: toNumber(lead.post_count),
    last_post_on: lead.last_post_on || null,
    average_likes: toNumber(lead.avg_likes),
    engagement_percent: engagementRate(lead),
    bio: lead.bio || '',
    has_link_in_bio: Boolean(lead.has_link),
    has_call_to_action: Boolean(lead.has_cta),
    highlight_count: toNumber(lead.highlight_count),
    reels_share_percent: lead.reels_share === null || lead.reels_share === undefined
      ? null
      : toNumber(lead.reels_share)
  };

  const findings = problems.length
    ? problems.map((problem) => `- [${problem.severity}] ${problem.title}: ${problem.detail}`).join('\n')
    : '- none detected';

  return [
    'Audit this Instagram business profile using ONLY the facts below.',
    'Do not add metrics, campaigns or results that are not listed.',
    '',
    'Facts (JSON):',
    JSON.stringify(facts, null, 2),
    '',
    'Rule-based findings:',
    findings,
    '',
    'Return JSON in exactly this shape:',
    '{"summary":"max 2 sentences, plain English, no praise padding",',
    ' "drafts":[{"label":"Direct","text":"..."},{"label":"Consultative","text":"..."}]}',
    '',
    'Draft rules:',
    '- 35 to 70 words, first person, no links, no prices, no guarantees, at most one emoji.',
    '- Open with the single most important observed issue, using the exact numbers given.',
    '- End with one easy yes/no question.',
    '- Describe what is missing; never call the profile bad or embarrassing.',
    '- Address the owner of the business, not "team" or "folks".'
  ].join('\n');
}

/** Accepts bare JSON or a fenced ```json block and normalises the shape. */
function parseAuditResponse(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('AI response was empty.');

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw;

  let data;
  try {
    data = JSON.parse(candidate);
  } catch (_) {
    throw new Error('AI response was not valid JSON.');
  }

  const summary = typeof data.summary === 'string' ? data.summary.trim().slice(0, 400) : '';
  const drafts = Array.isArray(data.drafts)
    ? data.drafts
      .filter((draft) => draft && typeof draft.text === 'string' && draft.text.trim())
      .slice(0, 3)
      .map((draft) => ({
        label: typeof draft.label === 'string' && draft.label.trim()
          ? draft.label.trim().slice(0, 24)
          : 'Draft',
        text: draft.text.trim().slice(0, 600)
      }))
    : [];

  if (!summary || !drafts.length) throw new Error('AI response was missing a summary or drafts.');
  return { summary, drafts };
}

async function callGemini({ apiKey, model, baseUrl, prompt, fetchImpl }) {
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const response = await (fetchImpl || fetch)(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 900,
        responseMimeType: 'application/json'
      }
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Gemini returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  const data = await response.json();
  const parts = data && data.candidates && data.candidates[0]
    && data.candidates[0].content && data.candidates[0].content.parts;
  const text = Array.isArray(parts)
    ? parts.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('')
    : '';

  if (!text.trim()) throw new Error('Gemini returned an empty response.');
  return text;
}

/**
 * Runs the rule audit, then optionally asks Gemini for a summary and drafts.
 * AI failure never fails the request: the deterministic result still returns
 * with `aiUsed: false` and an `aiError` note for the operator.
 */
async function runAudit(lead, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const base = auditLead(lead, now);
  const apiKey = options.apiKey || '';
  const model = options.model || DEFAULT_MODEL;
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const logger = options.logger || console;

  if (!apiKey) {
    return {
      ...base,
      summary: fallbackSummary(lead, base.problems),
      drafts: [{ label: 'Direct', text: fallbackDraft(lead, base.problems) }],
      aiUsed: false,
      aiError: ''
    };
  }

  try {
    const text = await callGemini({
      apiKey,
      model,
      baseUrl,
      prompt: buildAuditPrompt(lead, base.problems),
      fetchImpl: options.fetchImpl
    });
    const parsed = parseAuditResponse(text);
    return { ...base, summary: parsed.summary, drafts: parsed.drafts, aiUsed: true, aiError: '' };
  } catch (error) {
    logger.warn(`[outreach] AI audit failed: ${error.message}`);
    return {
      ...base,
      summary: fallbackSummary(lead, base.problems),
      drafts: [{ label: 'Direct', text: fallbackDraft(lead, base.problems) }],
      aiUsed: false,
      aiError: 'AI summary unavailable — showing the rule-based audit and a template draft.'
    };
  }
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  auditLead,
  engagementRate,
  daysSince,
  buildAuditPrompt,
  parseAuditResponse,
  runAudit
};
