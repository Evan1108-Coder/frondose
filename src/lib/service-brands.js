import openai from '@iconify-icons/logos/openai-icon';
import claude from '@iconify-icons/logos/claude-icon';
import github from '@iconify-icons/logos/github-icon';
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

// Trusted, bundled SVG Logos assets, not user-supplied SVG or remote HTML.
const entries = [
  ['openai', openai, ['codex', 'chatgpt'], ['openai.com', 'chatgpt.com']],
  ['claude', claude, ['anthropic'], ['claude.ai', 'anthropic.com']],
  ['github', github, ['github-packages', 'github packages'], ['github.com']],
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
