// Project actions shared by the Projects list and a project's page.
import { t } from '@/i18n';
import { deleteProject, type Project } from '@/projects';
import { getState, setChatProject } from '@/store';
import { confirm } from '@/ui/confirm';

/** Asks, then deletes a project, leaving its chats in the chat list. Resolves true when deleted. */
export async function removeProject(p: Project): Promise<boolean> {
  const ok = await confirm({
    title: t('Delete project?'),
    message: t('“{name}”, its instructions and its memory will be deleted. Its chats stay in your chat list.', { name: p.name }),
    action: t('Delete'),
    destructive: true,
  });
  if (!ok) return false;
  for (const chat of getState().chats) if (chat.projectId === p.id) setChatProject(chat.id, undefined);
  deleteProject(p.id);
  return true;
}
