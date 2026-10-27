// Connectors the phone can use on its own, checked to accept sign-in from a phone app (neru://mcp-auth).
// Some well-known servers only allow sign-in from a computer (Asana, Intercom, Zapier, Square, Slack, HubSpot);
// those work from the phone through a paired desktop instead.
import Constants from 'expo-constants';

export type Auth = 'oauth' | 'token' | 'none' | 'google';
export type CatalogEntry = { id: string; name: string; description: string; url: string; auth: Auth; logo?: string; scopes?: string; tokenHint?: string };

/** Optional iOS browser OAuth client. Android uses Play Services and its registered package/signing certificate. */
export const GOOGLE_CLIENT_ID = (Constants.expoConfig?.extra?.googleClientId as string | undefined) ?? '';

export const catalog: CatalogEntry[] = [
  { id: 'atlassian', name: 'Atlassian', description: 'Jira issues and Confluence pages', url: 'https://mcp.atlassian.com/v1/mcp', auth: 'oauth', logo: 'atlassian' },
  { id: 'github', name: 'GitHub', description: 'Repos, issues and pull requests', url: 'https://api.githubcopilot.com/mcp/', auth: 'token', logo: 'github', tokenHint: 'A personal access token from github.com/settings/tokens' },
  { id: 'gmail', name: 'Gmail', description: 'Search, read, label and draft email', url: 'https://gmail.googleapis.com', auth: 'google', logo: 'gmail', scopes: 'https://www.googleapis.com/auth/gmail.modify' },
  { id: 'google-calendar', name: 'Google Calendar', description: 'Events, availability and invitations', url: 'https://www.googleapis.com/calendar/v3', auth: 'google', logo: 'googlecalendar', scopes: 'https://www.googleapis.com/auth/calendar' },
  { id: 'google-drive', name: 'Google Drive', description: 'Find and read your files', url: 'https://www.googleapis.com/drive/v3', auth: 'google', logo: 'googledrive', scopes: 'https://www.googleapis.com/auth/drive' },
  { id: 'linear', name: 'Linear', description: 'Issues, projects and cycles', url: 'https://mcp.linear.app/mcp', auth: 'oauth', logo: 'linear' },
  { id: 'notion', name: 'Notion', description: 'Search, read and update pages', url: 'https://mcp.notion.com/mcp', auth: 'oauth', logo: 'notion' },
  { id: 'gitlab', name: 'GitLab', description: 'Projects, issues and merge requests', url: 'https://gitlab.com/api/v4/mcp', auth: 'oauth', logo: 'gitlab' },
  { id: 'sentry', name: 'Sentry', description: 'Errors, issues and stack traces', url: 'https://mcp.sentry.dev/mcp', auth: 'oauth', logo: 'sentry' },
  { id: 'canva', name: 'Canva', description: 'Search, create and edit designs', url: 'https://mcp.canva.com/mcp', auth: 'oauth', logo: 'canva' },
  { id: 'paypal', name: 'PayPal', description: 'Invoices, orders and transactions', url: 'https://mcp.paypal.com/mcp', auth: 'oauth', logo: 'paypal' },
  { id: 'webflow', name: 'Webflow', description: 'Sites, CMS collections and pages', url: 'https://mcp.webflow.com/mcp', auth: 'oauth', logo: 'webflow' },
  { id: 'wix', name: 'Wix', description: 'Sites, stores and bookings', url: 'https://mcp.wix.com/mcp', auth: 'oauth', logo: 'wix' },
  { id: 'neon', name: 'Neon', description: 'Postgres projects, branches and SQL', url: 'https://mcp.neon.tech/mcp', auth: 'oauth', logo: 'neon' },
  { id: 'netlify', name: 'Netlify', description: 'Sites, deploys and environment variables', url: 'https://netlify-mcp.netlify.app/mcp', auth: 'oauth', logo: 'netlify' },
  { id: 'cloudflare', name: 'Cloudflare', description: 'Workers, KV, R2 and D1', url: 'https://bindings.mcp.cloudflare.com/mcp', auth: 'oauth', logo: 'cloudflare' },
  { id: 'prisma', name: 'Prisma Postgres', description: 'Databases, migrations and queries', url: 'https://mcp.prisma.io/mcp', auth: 'oauth', logo: 'prisma' },
  { id: 'jam', name: 'Jam', description: 'Bug reports with logs and repro steps', url: 'https://mcp.jam.dev/mcp', auth: 'oauth' },
  { id: 'exa', name: 'Exa', description: 'Web and code search', url: 'https://mcp.exa.ai/mcp', auth: 'none' },
  { id: 'context7', name: 'Context7', description: 'Up-to-date library docs and examples', url: 'https://mcp.context7.com/mcp', auth: 'none' },
  { id: 'deepwiki', name: 'DeepWiki', description: 'Ask about any public GitHub repository', url: 'https://mcp.deepwiki.com/mcp', auth: 'none' },
  { id: 'huggingface', name: 'Hugging Face', description: 'Models, datasets, papers and Spaces', url: 'https://huggingface.co/mcp', auth: 'none', logo: 'huggingface' },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', description: 'Search the Cloudflare developer docs', url: 'https://docs.mcp.cloudflare.com/mcp', auth: 'none', logo: 'cloudflare' },
];

export const logoUrl = (logo?: string) => (logo ? `https://cdn.simpleicons.org/${logo}` : null);
