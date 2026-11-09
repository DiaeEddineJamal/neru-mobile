// Connectors the phone can use on its own, checked to accept sign-in from a phone app (neru://mcp-auth).
// Some well-known servers only allow sign-in from a computer (Asana, Intercom, Zapier, Square, Slack, HubSpot);
// those work from the phone through a paired desktop instead.
import Constants from 'expo-constants';

export type Auth = 'oauth' | 'token' | 'none' | 'google';
export type Category = 'Productivity' | 'Developer tools' | 'Communication' | 'Files & docs' | 'Design' | 'Data & analytics' | 'Commerce & shopping' | 'Search & research' | 'Other';
/** Browse-view chip order. */
export const categories: Category[] = ['Productivity', 'Developer tools', 'Communication', 'Files & docs', 'Design', 'Data & analytics', 'Commerce & shopping', 'Search & research', 'Other'];
export type CatalogEntry = {
  id: string;
  name: string;
  /** One short line, shown on the browse card. */
  description: string;
  url: string;
  auth: Auth;
  logo?: string;
  scopes?: string;
  tokenHint?: string;
  category: Category;
  /** Brand color for the letter tile when there is no logo. */
  color?: string;
};

/** Optional iOS browser OAuth client. Android uses Play Services and its registered package/signing certificate. */
export const GOOGLE_CLIENT_ID = (Constants.expoConfig?.extra?.googleClientId as string | undefined) ?? '';

export const catalog: CatalogEntry[] = [
  { id: 'atlassian', name: 'Atlassian', description: 'Jira issues and Confluence pages', url: 'https://mcp.atlassian.com/v1/mcp', auth: 'oauth', logo: 'atlassian', category: 'Productivity', color: '#0052CC' },
  { id: 'github', name: 'GitHub', description: 'Repos, issues and pull requests', url: 'https://api.githubcopilot.com/mcp/', auth: 'token', logo: 'github', tokenHint: 'A personal access token from github.com/settings/tokens', category: 'Developer tools', color: '#181717' },
  { id: 'gmail', name: 'Gmail', description: 'Search, read, label and draft email', url: 'https://gmail.googleapis.com', auth: 'google', logo: 'gmail', scopes: 'https://www.googleapis.com/auth/gmail.modify', category: 'Communication', color: '#EA4335' },
  { id: 'google-calendar', name: 'Google Calendar', description: 'Events, availability and invitations', url: 'https://www.googleapis.com/calendar/v3', auth: 'google', logo: 'googlecalendar', scopes: 'https://www.googleapis.com/auth/calendar', category: 'Productivity', color: '#4285F4' },
  { id: 'google-drive', name: 'Google Drive', description: 'Find and read your files', url: 'https://www.googleapis.com/drive/v3', auth: 'google', logo: 'googledrive', scopes: 'https://www.googleapis.com/auth/drive', category: 'Files & docs', color: '#1FA463' },
  { id: 'linear', name: 'Linear', description: 'Issues, projects and cycles', url: 'https://mcp.linear.app/mcp', auth: 'oauth', logo: 'linear', category: 'Productivity', color: '#5E6AD2' },
  { id: 'notion', name: 'Notion', description: 'Search, read and update pages', url: 'https://mcp.notion.com/mcp', auth: 'oauth', logo: 'notion', category: 'Files & docs', color: '#191919' },
  { id: 'gitlab', name: 'GitLab', description: 'Projects, issues and merge requests', url: 'https://gitlab.com/api/v4/mcp', auth: 'oauth', logo: 'gitlab', category: 'Developer tools', color: '#FC6D26' },
  { id: 'sentry', name: 'Sentry', description: 'Errors, issues and stack traces', url: 'https://mcp.sentry.dev/mcp', auth: 'oauth', logo: 'sentry', category: 'Developer tools', color: '#362D59' },
  { id: 'canva', name: 'Canva', description: 'Search, create and edit designs', url: 'https://mcp.canva.com/mcp', auth: 'oauth', logo: 'canva', category: 'Design', color: '#00C4CC' },
  { id: 'paypal', name: 'PayPal', description: 'Invoices, orders and transactions', url: 'https://mcp.paypal.com/mcp', auth: 'oauth', logo: 'paypal', category: 'Commerce & shopping', color: '#003087' },
  { id: 'webflow', name: 'Webflow', description: 'Sites, CMS collections and pages', url: 'https://mcp.webflow.com/mcp', auth: 'oauth', logo: 'webflow', category: 'Design', color: '#146EF5' },
  { id: 'wix', name: 'Wix', description: 'Sites, stores and bookings', url: 'https://mcp.wix.com/mcp', auth: 'oauth', logo: 'wix', category: 'Commerce & shopping', color: '#0C6EFC' },
  { id: 'neon', name: 'Neon', description: 'Postgres projects, branches and SQL', url: 'https://mcp.neon.tech/mcp', auth: 'oauth', logo: 'neon', category: 'Data & analytics', color: '#00A86B' },
  { id: 'netlify', name: 'Netlify', description: 'Sites, deploys and environment variables', url: 'https://netlify-mcp.netlify.app/mcp', auth: 'oauth', logo: 'netlify', category: 'Developer tools', color: '#00AD9F' },
  { id: 'cloudflare', name: 'Cloudflare', description: 'Workers, KV, R2 and D1', url: 'https://bindings.mcp.cloudflare.com/mcp', auth: 'oauth', logo: 'cloudflare', category: 'Developer tools', color: '#F38020' },
  { id: 'prisma', name: 'Prisma Postgres', description: 'Databases, migrations and queries', url: 'https://mcp.prisma.io/mcp', auth: 'oauth', logo: 'prisma', category: 'Data & analytics', color: '#2D3748' },
  { id: 'jam', name: 'Jam', description: 'Bug reports with logs and repro steps', url: 'https://mcp.jam.dev/mcp', auth: 'oauth', category: 'Developer tools', color: '#E5397B' },
  { id: 'exa', name: 'Exa', description: 'Web and code search', url: 'https://mcp.exa.ai/mcp', auth: 'none', category: 'Search & research', color: '#1F40ED' },
  { id: 'context7', name: 'Context7', description: 'Up-to-date library docs and examples', url: 'https://mcp.context7.com/mcp', auth: 'none', category: 'Developer tools', color: '#059669' },
  { id: 'deepwiki', name: 'DeepWiki', description: 'Ask about any public GitHub repository', url: 'https://mcp.deepwiki.com/mcp', auth: 'none', category: 'Search & research', color: '#2563EB' },
  { id: 'huggingface', name: 'Hugging Face', description: 'Models, datasets, papers and Spaces', url: 'https://huggingface.co/mcp', auth: 'none', logo: 'huggingface', category: 'Data & analytics', color: '#E8A800' },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', description: 'Search the Cloudflare developer docs', url: 'https://docs.mcp.cloudflare.com/mcp', auth: 'none', logo: 'cloudflare', category: 'Search & research', color: '#F38020' },
];

export const logoUrl = (logo?: string) => (logo ? `https://cdn.simpleicons.org/${logo}` : null);

/** The catalog entry an added connector came from (same address, or same logo), if any. */
export const entryFor = (c: { url: string; logo?: string }) => catalog.find(e => e.url === c.url) ?? (c.logo ? catalog.find(e => e.logo === c.logo) : undefined);

const TILE_COLORS = ['#5E6AD2', '#E5397B', '#00AD9F', '#F38020', '#2563EB', '#7C3AED', '#059669', '#DC2626'];
/** A stable color for a connector's letter tile: its brand color, else one picked from its name. */
export function tileColor(name: string, color?: string) {
  if (color) return color;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return TILE_COLORS[Math.abs(h) % TILE_COLORS.length];
}
