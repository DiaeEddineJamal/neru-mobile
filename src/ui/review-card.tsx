// A second model's opinion on a proposed change: agrees, or has concerns with its notes. Shown above the approval.
import { Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import type { Review } from '@/shared/types';
import { font, fs, useColors } from '@/theme';
import { Loader } from '@/ui/loader';
import { t } from '@/i18n';

export function ReviewCard({ review }: { review: Review }) {
  const c = useColors();
  const tone = review.status === 'agree' ? c.moss : review.status === 'concerns' ? c.danger : c.muted;
  const title =
    review.status === 'running' ? t('{reviewer} is checking this change…', { reviewer: review.reviewer })
    : review.status === 'agree' ? t('2 models agree · {reviewer} checked it', { reviewer: review.reviewer })
    : review.status === 'concerns' ? t('{reviewer} has concerns', { reviewer: review.reviewer })
    : review.status === 'skipped' ? t('No second opinion')
    : t('The second opinion did not finish');
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: 6, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: `${tone}55`, backgroundColor: `${tone}14` }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {review.status === 'running' ? <Loader size={14} /> : <Icon name={review.status === 'agree' ? 'checkCircle' : review.status === 'concerns' ? 'warning' : 'alertCircle'} size={16} color={tone} />}
        <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: fs.sm, color: c.text }}>{title}</Text>
      </View>
      {review.summary ? <Text style={{ fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, color: c.secondary }}>{review.summary}</Text> : null}
      {review.notes.map((n, i) => (
        <Text key={i} style={{ fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, color: c.text }}>• {n}</Text>
      ))}
    </View>
  );
}
