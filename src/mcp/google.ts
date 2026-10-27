import { McpHttpError, type McpTool } from './client';
type Service = 'gmail' | 'drive' | 'calendar';
type BinaryReader = (url: string, name: string, mime: string, token: string) => Promise<string>;
export function googleService(url: string): Service | null {
  const host = /^https:\/\/([^/]+)/.exec(url)?.[1];
  if (host === 'gmailmcp.googleapis.com' || host === 'gmail.googleapis.com') return 'gmail';
  if (host === 'drivemcp.googleapis.com' || (host === 'www.googleapis.com' && url.includes('/drive/'))) return 'drive';
  if (host === 'calendarmcp.googleapis.com' || (host === 'www.googleapis.com' && url.includes('/calendar/'))) return 'calendar';
  return null;
}
const str = { type: 'string' };
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], readOnly = true): McpTool => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, readOnly });
const descriptors: Record<Service, McpTool[]> = {
  gmail: [
    tool('search_messages', 'Search Gmail using Gmail search syntax; returns message IDs.', { query: str }, ['query']),
    tool('get_message', 'Read a Gmail message with its headers and decoded text body.', { message_id: str }, ['message_id']),
    tool('list_labels', 'List Gmail labels and their IDs.', {}, []),
    tool('create_draft', 'Create an email draft for review. Does not send mail.', { to: str, subject: str, body: str }, ['to', 'subject', 'body'], false),
    tool('modify_labels', 'Add or remove label IDs on a message.', { message_id: str, add_label_ids: { type: 'array', items: str }, remove_label_ids: { type: 'array', items: str } }, ['message_id'], false),
  ],
  drive: [
    tool('search_files', 'Search Drive with Drive query syntax, e.g. trashed = false and name contains \'journal\'.', { query: str }, ['query']),
    tool('read_file', 'Extract text from a Drive file: Google Docs, Sheets, Slides, PDF, Word, PowerPoint, Excel or text.', { file_id: str }, ['file_id']),
    tool('create_document', 'Create a Google document with a title and plain text content.', { title: str, content: str }, ['title', 'content'], false),
  ],
  calendar: [
    tool('list_calendars', 'List Google calendars and their IDs.', {}, []),
    tool('list_events', 'List events in a calendar in an RFC3339 time range.', { calendar_id: str, time_min: str, time_max: str }, ['calendar_id', 'time_min', 'time_max']),
    tool('create_event', 'Create a calendar event. Start/end must be RFC3339 with a timezone offset.', { calendar_id: str, title: str, start: str, end: str, description: str }, ['calendar_id', 'title', 'start', 'end'], false),
  ],
};
const enc = encodeURIComponent;
async function googleFetch(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
const mailText = (part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): string => {
  if (part.parts?.length) return part.parts.map(p => mailText(p as typeof part)).filter(Boolean).join('\n');
  if (!part.body?.data || !part.mimeType?.startsWith('text/')) return '';
  const data = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
  const text = new TextDecoder().decode(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
  return part.mimeType === 'text/html' ? text.replace(/<[^>]*>/g, ' ') : text;
};
const required = (args: Record<string, unknown>, key: string) => { const value = args[key]; if (typeof value !== 'string' || !value.trim()) throw Error(`A nonempty ${key} is required.`); return value; };
/** Regular Workspace APIs avoid the remote MCP developer-preview restriction. Tool approvals still apply. */
export class GoogleWorkspaceClient {
  constructor(readonly url: string, private service: Service, private auth: () => Promise<string | null>, private binary: BinaryReader) {}
  reset() {}
  private async request(path: string, method = 'GET', body?: unknown) {
    const token = await this.auth();
    if (!token) throw new McpHttpError('Sign in to Google again.', 401, null);
    const base = this.service === 'gmail' ? 'https://gmail.googleapis.com/gmail/v1/users/me' : this.service === 'drive' ? 'https://www.googleapis.com/drive/v3' : 'https://www.googleapis.com/calendar/v3';
    const response = await googleFetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new McpHttpError(data.error?.message ?? `Google API error ${response.status}`, response.status, null);
    return data;
  }
  async tools() {
    await this.request(this.service === 'gmail' ? '/profile' : this.service === 'drive' ? '/about?fields=user(displayName)' : '/users/me/calendarList?maxResults=1');
    return descriptors[this.service];
  }
  async call(name: string, args: Record<string, unknown>): Promise<string> {
    if (!descriptors[this.service].some(t => t.name === name)) throw Error('Unknown Google tool.');
    const get = (key: string) => required(args, key);
    let result: unknown;
    if (name === 'search_messages') result = await this.request(`/messages?maxResults=30&q=${enc(get('query'))}`);
    else if (name === 'get_message') {
      const message = await this.request(`/messages/${enc(get('message_id'))}?format=full`);
      result = { id: message.id, threadId: message.threadId, labelIds: message.labelIds, headers: message.payload?.headers, text: mailText(message.payload ?? {}).slice(0, 200_000) };
    }
    else if (name === 'list_labels') result = await this.request('/labels');
    else if (name === 'create_draft') {
      const to = get('to'), subject = get('subject');
      if (/[\r\n]/.test(to + subject)) throw Error('Email headers cannot contain newlines.');
      if (to.length > 2_000 || subject.length > 1_000 || get('body').length > 200_000) throw Error('This email draft is too large.');
      const bytes = new TextEncoder().encode(`To: ${to}\r\nSubject: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${get('body')}`);
      if (bytes.length > 200_000) throw Error('This email draft is too large.');
      let raw = ''; for (const b of bytes) raw += String.fromCharCode(b);
      result = await this.request('/drafts', 'POST', { message: { raw: btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } });
    } else if (name === 'modify_labels') {
      for (const key of ['add_label_ids', 'remove_label_ids']) if (args[key] !== undefined && (!Array.isArray(args[key]) || (args[key] as unknown[]).some(v => typeof v !== 'string'))) throw Error(`${key} must be an array of label IDs.`);
      result = await this.request(`/messages/${enc(get('message_id'))}/modify`, 'POST', { addLabelIds: args.add_label_ids ?? [], removeLabelIds: args.remove_label_ids ?? [] });
    } else if (name === 'search_files') result = await this.request(`/files?pageSize=50&q=${enc(get('query'))}&fields=files(id,name,mimeType,size),nextPageToken`);
    else if (name === 'read_file') {
      const id = enc(get('file_id'));
      const file = await this.request(`/files/${id}?fields=id,name,mimeType,size`);
      if (Number(file.size) > 50 * 1024 * 1024) throw Error('This Drive document is larger than 50 MB.');
      const exports: Record<string, [string, string]> = {
        'application/vnd.google-apps.document': ['text/plain', '.txt'],
        'application/vnd.google-apps.spreadsheet': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
        'application/vnd.google-apps.presentation': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
      };
      const format = exports[file.mimeType];
      if (!format && file.mimeType.startsWith('application/vnd.google-apps.')) throw Error('This Google file type cannot be exported as a document.');
      const token = await this.auth(); if (!token) throw new McpHttpError('Sign in to Google again.', 401, null);
      result = await this.binary(`https://www.googleapis.com/drive/v3/files/${id}${format ? `/export?mimeType=${enc(format[0])}` : '?alt=media'}`, file.name + (format?.[1] ?? ''), format?.[0] ?? file.mimeType, token);
    } else if (name === 'create_document') {
      // Multipart upload imports plain text as a native Google Doc in one request.
      const token = await this.auth(); if (!token) throw new McpHttpError('Sign in to Google again.', 401, null);
      const boundary = `neru_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const content = get('content'); if (content.length > 200_000) throw Error('This document is too large.');
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: get('title'), mimeType: 'application/vnd.google-apps.document' })}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
      const response = await googleFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      result = await response.json(); if (!response.ok) throw Error(`Google document creation failed (${response.status}).`);
    } else if (name === 'list_calendars') result = await this.request('/users/me/calendarList?maxResults=100');
    else if (name === 'list_events') result = await this.request(`/calendars/${enc(get('calendar_id'))}/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${enc(get('time_min'))}&timeMax=${enc(get('time_max'))}`);
    else if (name === 'create_event') {
      const start = get('start'), end = get('end');
      if (![start, end].every(v => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))) || Date.parse(end) <= Date.parse(start)) throw Error('Use valid start/end times with timezone offsets, ending after the start.');
      result = await this.request(`/calendars/${enc(get('calendar_id'))}/events`, 'POST', { summary: get('title'), description: args.description, start: { dateTime: start }, end: { dateTime: end } });
    }
    return typeof result === 'string' ? result : JSON.stringify(result);
  }
}
