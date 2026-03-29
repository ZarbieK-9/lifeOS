import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import dayjs from 'dayjs';
import { useStore } from '@/src/store/useStore';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';
import { EmptyExpenses } from '@/src/components/illustrations';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Typography } from '@/constants/theme';

export default function SpendingScreen() {
  const { theme } = useAppTheme();
  const todaySpend = useStore((s) => s.todaySpend);
  const monthSpend = useStore((s) => s.monthSpend);
  const expenses = useStore((s) => s.expenses);

  return (
    <ScreenContainer scroll header={<ScreenHeader title="Spending" />}>
      <Section title="Summary" description="Today and this month.">
        <Card variant="elevated">
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.textSecondary }]}>
              Today
            </Text>
            <Text style={[ss.amount, { color: theme.danger }]}>
              ${todaySpend.toFixed(0)}
            </Text>
          </View>
          <View style={[ss.row, { marginTop: 8 }]}>
            <Text style={[ss.label, { color: theme.textSecondary }]}>
              This month
            </Text>
            <Text style={[ss.amount, { color: theme.danger }]}>
              ${monthSpend.toFixed(0)}
            </Text>
          </View>
        </Card>
      </Section>

      <Section title="Recent expenses">
        {expenses.length === 0 ? (
          <Card variant="outlined">
            <Text style={[ss.empty, { color: theme.textSecondary }]}>
              No expenses logged yet.
            </Text>
          </Card>
        ) : (
          expenses.slice(0, 50).map((item) => (
            <Card key={item.expense_id} variant="outlined" style={ss.expenseCard}>
              <View style={ss.row}>
                <View style={ss.expenseMain}>
                  <Text style={[ss.expenseCategory, { color: theme.primary }]}>
                    {item.category}
                  </Text>
                  <Text style={[ss.meta, { color: theme.textSecondary }]}>
                    {dayjs(item.date).format('MMM D, YYYY')}
                  </Text>
                </View>
                <Text style={[ss.amount, { color: theme.text }]}>
                  ${item.amount.toFixed(2)}
                </Text>
              </View>
              {item.note ? (
                <Text
                  style={[ss.meta, { color: theme.textSecondary }, { marginTop: 4 }]}
                  numberOfLines={1}
                >
                  {item.note}
                </Text>
              ) : null}
            </Card>
          ))
        )}
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { ...Typography.footnote },
  amount: { fontSize: 18, fontWeight: '700' },
  emptyWrap: { alignItems: 'center', paddingVertical: 12, gap: 8 },
  empty: { ...Typography.body, textAlign: 'center' },
  expenseCard: { marginBottom: 8 },
  expenseMain: { flex: 1, minWidth: 0 },
  expenseCategory: { ...Typography.headline, fontSize: 15 },
  meta: { fontSize: 13 },
});
