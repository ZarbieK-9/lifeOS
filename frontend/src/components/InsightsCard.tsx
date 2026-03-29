import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  Heart,
  Target,
  DollarSign,
  Users,
  Sparkles,
  X,
  Zap,
} from 'lucide-react-native';
import { useStore } from '@/src/store/useStore';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Card, CardHeader } from '@/src/components/Card';
import { Section } from '@/src/components/layout';
import type { WatcherNotification } from '@/src/agent/types';
import type { GoalDomain } from '@/src/agent/types';

dayjs.extend(relativeTime);

const DOMAIN_CONFIG: Record<
  string,
  { icon: typeof Heart; color: string }
> = {
  health: { icon: Heart, color: '#FF3B30' },
  productivity: { icon: Target, color: '#007AFF' },
  finance: { icon: DollarSign, color: '#34C759' },
  social: { icon: Users, color: '#AF52DE' },
};

function getDomainConfig(domain: GoalDomain | null) {
  if (domain && DOMAIN_CONFIG[domain]) return DOMAIN_CONFIG[domain];
  return { icon: Sparkles, color: '#FF9500' };
}

function InsightItem({ item }: { item: WatcherNotification }) {
  const { theme } = useAppTheme();
  const markWatcherRead = useStore((s) => s.markWatcherRead);
  const executeWatcherSuggestedAction = useStore(
    (s) => s.executeWatcherSuggestedAction,
  );
  const [loading, setLoading] = useState(false);

  const config = getDomainConfig(item.domain);
  const Icon = config.icon;

  const handleAction = async () => {
    setLoading(true);
    try {
      await executeWatcherSuggestedAction(item.id);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    markWatcherRead(item.id);
  };

  return (
    <View style={[styles.item, { borderBottomColor: theme.border }]}>
      <View style={[styles.iconWrap, { backgroundColor: config.color + '18' }]}>
        <Icon size={16} color={config.color} strokeWidth={2} />
      </View>
      <View style={styles.itemContent}>
        <View style={styles.itemHeader}>
          <Text
            style={[styles.itemTitle, { color: theme.text }]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          {item.priority === 'high' && (
            <View style={[styles.priorityDot, { backgroundColor: '#FF3B30' }]} />
          )}
        </View>
        <Text
          style={[styles.itemBody, { color: theme.textSecondary }]}
          numberOfLines={2}
        >
          {item.body}
        </Text>
        <View style={styles.itemFooter}>
          <Text style={[styles.timeAgo, { color: theme.textSecondary }]}>
            {dayjs(item.createdAt).fromNow()}
          </Text>
          {item.suggestedAction && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: theme.primary }]}
              onPress={handleAction}
              disabled={loading}
            >
              <Zap size={12} color="#fff" strokeWidth={2} />
              <Text style={styles.actionText}>
                {loading ? '...' : 'Apply'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <TouchableOpacity
        style={styles.dismissBtn}
        onPress={handleDismiss}
        hitSlop={8}
      >
        <X size={14} color={theme.textSecondary} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

export function InsightsCard() {
  const { theme } = useAppTheme();
  const watcherQueue = useStore((s) => s.watcherQueue);
  const clearWatcherQueue = useStore((s) => s.clearWatcherQueue);

  if (watcherQueue.length === 0) return null;

  return (
    <Section title="">
      <Card variant="outlined">
        <CardHeader
          title={`Insights (${watcherQueue.length})`}
          icon={<Sparkles size={18} color={theme.primary} strokeWidth={2} />}
          action={
            <TouchableOpacity onPress={clearWatcherQueue}>
              <Text style={[styles.clearBtn, { color: theme.textSecondary }]}>
                Clear all
              </Text>
            </TouchableOpacity>
          }
        />
        {watcherQueue.slice(0, 5).map((item) => (
          <InsightItem key={item.id} item={item} />
        ))}
        {watcherQueue.length > 5 && (
          <Text
            style={[styles.moreText, { color: theme.textSecondary }]}
          >
            +{watcherQueue.length - 5} more
          </Text>
        )}
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  itemContent: {
    flex: 1,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  itemBody: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  itemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  timeAgo: {
    fontSize: 11,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  dismissBtn: {
    padding: 4,
    marginTop: 2,
  },
  clearBtn: {
    fontSize: 13,
  },
  moreText: {
    fontSize: 12,
    textAlign: 'center',
    paddingTop: 8,
  },
});
