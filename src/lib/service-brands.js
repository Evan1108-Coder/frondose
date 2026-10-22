import openai from '@iconify-icons/logos/openai-icon';
import codex from '@iconify-icons/logos/codex';
import anthropic from '@iconify-icons/logos/anthropic-icon';
import claude from '@iconify-icons/logos/claude-icon';
import huggingFace from '@iconify-icons/logos/hugging-face-icon';
import github from '@iconify-icons/logos/github-icon';
import copilot from '@iconify-icons/logos/github-copilot';
import drive from '@iconify-icons/logos/google-drive-2020';
import google from '@iconify-icons/logos/google-icon';
import slack from '@iconify-icons/logos/slack-icon';
import teams from '@iconify-icons/logos/microsoft-teams';
import discord from '@iconify-icons/logos/discord-icon';
import notion from '@iconify-icons/logos/notion-icon';
import gitlab from '@iconify-icons/logos/gitlab-icon';
import mcp from '@iconify-icons/logos/model-context-protocol-icon';
import linear from '@iconify-icons/logos/linear-icon';
import jira from '@iconify-icons/logos/jira';
import figma from '@iconify-icons/logos/figma';
import githubActions from '@iconify-icons/logos/github-actions';
import gemini from '@iconify-icons/logos/google-gemini-icon';
import mistral from '@iconify-icons/logos/mistral-ai-icon';
import deepseek from '@iconify-icons/logos/deepseek-icon';
import perplexity from '@iconify-icons/logos/perplexity-icon';
import qwen from '@iconify-icons/logos/qwen-icon';
import grok from '@iconify-icons/logos/grok-icon';
import runnerAssets from './runner-brand-assets.json' with { type: 'json' };
// OpenRouter company mark, Simple Icons (CC0-1.0); source recorded in Docs.
const openrouter = { width: 24, height: 24, body: '<path d="M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z"/>' };

// Trusted, bundled SVG Logos assets, not user-supplied SVG or remote HTML.
const entries = [
  ['openai', openai, ['openai api', 'chatgpt'], ['openai.com', 'chatgpt.com']],
  ['codex', codex, [], []],
  ['openrouter', openrouter, ['open router'], ['openrouter.ai']],
  ['gemini', gemini, ['google gemini', 'google gemini api'], ['ai.google.dev', 'aistudio.google.com']],
  ['mistral', mistral, ['mistral ai'], ['mistral.ai']],
  ['deepseek', deepseek, [], ['deepseek.com']],
  ['perplexity', perplexity, [], ['perplexity.ai']],
  ['qwen', qwen, ['alibaba / qwen'], ['modelstudio.console.aliyun.com']],
  ['xai', grok, ['xai', 'grok', 'grok api'], ['x.ai']],
  ['claude', claude, ['claude code'], ['claude.ai']],
  ['anthropic', anthropic, ['anthropic api'], ['anthropic.com']],
  ['hugging-face', huggingFace, ['hugging face', 'hugging face inference', 'huggingface'], ['huggingface.co']],
  ['github', github, ['github-packages', 'github packages'], ['github.com']],
  ['copilot', copilot, ['github copilot'], []],
  ['github-actions', githubActions, ['github actions'], []],
  ['linear', linear, [], ['linear.app']],
  ['jira', jira, [], ['atlassian.net', 'atlassian.com']],
  ['figma', figma, ['figjam'], ['figma.com']],
  ['google-drive', drive, ['google_drive', 'google drive'], ['drive.google.com']],
  ['google', google, ['google account'], ['google.com']],
  ['slack', slack, [], ['slack.com']],
  ['microsoft-teams', teams, ['microsoft teams', 'teams'], ['teams.microsoft.com']],
  ['discord', discord, [], ['discord.com', 'discord.gg']],
  ['notion', notion, [], ['notion.so', 'notion.site']],
  ['gitlab', gitlab, [], ['gitlab.com']],
  ['mcp', mcp, ['model context protocol'], ['modelcontextprotocol.io']],
];
const brands = entries.map(([id, icon, aliases, domains]) => ({
  id, aliases: [id, ...aliases], domains,
  src: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${icon.width}" height="${icon.height}" viewBox="0 0 ${icon.width} ${icon.height}">${icon.body}</svg>`)}`,
}));
brands.push(...['docs', 'sheets', 'slides'].map(product => ({ id: `google-${product}`, aliases: [`google-${product}`, `google ${product}`], domains: [], src: `/brand/services/google-${product}.png` })));
brands.push(...[
  ['groq', ['groq'], ['groq.com']], ['together', ['together', 'together ai'], ['together.ai']],
  ['fireworks', ['fireworks', 'fireworks ai'], ['fireworks.ai']], ['cohere', ['cohere'], ['cohere.com']],
  ['kimi', ['kimi', 'moonshot', 'moonshot / kimi'], ['kimi.ai', 'moonshot.ai', 'moonshot.cn']],
  ['zai', ['zai', 'z.ai', 'z.ai / glm'], ['z.ai', 'bigmodel.cn']],
].map(([id, aliases, domains]) => ({ id, aliases, domains, src: `/brand/services/${id}.svg` })));
// Static, safety-reviewed files only. No host-provided SVG is accepted here.
// Keep established API/service identities when the runtime shares their ID.
for (const asset of runnerAssets.assets) {
  const existing = brands.find(brand => brand.aliases.includes(asset.id));
  if (existing) {
    const titleAlias = asset.title.toLowerCase();
    if (!existing.aliases.includes(titleAlias)) existing.aliases.push(titleAlias);
  } else {
    brands.push({ id: asset.id, aliases: [asset.id, asset.title.toLowerCase()], domains: [], src: asset.src, rendering: asset.rendering });
  }
}

export function safeWebsiteUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function serviceBrand(name, value) {
  const named = brands.find(brand => brand.aliases.includes(String(name ?? '').trim().toLowerCase()));
  if (named) return named;
  const url = safeWebsiteUrl(value);
  return url ? brands.find(brand => brand.domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) : undefined;
}
