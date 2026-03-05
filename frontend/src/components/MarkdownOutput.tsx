// MarkdownOutput — AI response renderer with lists, tables, and readable formatting

import React, { useMemo } from 'react';
import { useColorScheme, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { ScreenColors } from '@/constants/theme';

export interface MarkdownTheme {
  text: string;
  codeBg: string;
  border: string;
}

interface Props {
  children: string;
  /** Optional theme for chat bubbles (e.g. calm colors). Falls back to screen light/dark. */
  theme?: MarkdownTheme;
}

export default React.memo(function MarkdownOutput({ children, theme: customTheme }: Props) {
  const scheme = useColorScheme();
  const screen = scheme === 'dark' ? ScreenColors.dark : ScreenColors.light;
  const theme = customTheme ?? { text: screen.text, codeBg: screen.codeBg, border: screen.border };
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return <Markdown style={styles}>{children}</Markdown>;
});

function makeStyles(t: { text: string; codeBg: string; border: string }) {
  return StyleSheet.create({
    // Base
    body: {
      color: t.text,
      fontSize: 15,
      lineHeight: 24,
      flexWrap: 'wrap',
    },
    text: { color: t.text },
    textgroup: { color: t.text },

    // Paragraphs & spacing
    paragraph: {
      color: t.text,
      marginTop: 6,
      marginBottom: 6,
      lineHeight: 24,
      flexWrap: 'wrap',
    },

    // Headings
    heading1: { fontWeight: '700', fontSize: 18, marginTop: 12, marginBottom: 6, color: t.text },
    heading2: { fontWeight: '700', fontSize: 17, marginTop: 10, marginBottom: 4, color: t.text },
    heading3: { fontWeight: '600', fontSize: 16, marginTop: 8, marginBottom: 4, color: t.text },
    heading4: { fontWeight: '600', fontSize: 15, marginTop: 6, marginBottom: 2, color: t.text },
    heading5: { fontWeight: '600', fontSize: 14, marginTop: 4, marginBottom: 2, color: t.text },
    heading6: { fontWeight: '600', fontSize: 13, marginTop: 4, marginBottom: 2, color: t.text },

    // Emphasis
    strong: { fontWeight: '700', color: t.text },
    em: { fontStyle: 'italic', color: t.text },
    s: { textDecorationLine: 'line-through', color: t.text },

    // Lists — ensure bullets/numbers and content are clearly separated
    bullet_list: {
      marginVertical: 6,
      paddingLeft: 4,
    },
    ordered_list: {
      marginVertical: 6,
      paddingLeft: 4,
    },
    list_item: {
      flexDirection: 'row',
      marginVertical: 3,
      alignItems: 'flex-start',
    },
    bullet_list_icon: {
      color: t.text,
      fontSize: 15,
      lineHeight: 24,
      marginRight: 8,
      minWidth: 16,
    },
    bullet_list_content: {
      flex: 1,
      color: t.text,
    },
    ordered_list_icon: {
      color: t.text,
      fontSize: 15,
      lineHeight: 24,
      marginRight: 8,
      minWidth: 24,
    },
    ordered_list_content: {
      flex: 1,
      color: t.text,
    },

    // Blockquote
    blockquote: {
      backgroundColor: t.codeBg,
      borderLeftWidth: 4,
      borderLeftColor: t.border,
      marginVertical: 8,
      paddingVertical: 6,
      paddingHorizontal: 12,
      paddingRight: 12,
    },

    // Code
    code_inline: {
      backgroundColor: t.codeBg,
      fontFamily: 'monospace',
      fontSize: 13,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      color: t.text,
    },
    code_block: {
      backgroundColor: t.codeBg,
      borderRadius: 8,
      padding: 12,
      fontFamily: 'monospace',
      fontSize: 13,
      marginVertical: 8,
      color: t.text,
    },
    fence: {
      backgroundColor: t.codeBg,
      borderRadius: 8,
      padding: 12,
      fontFamily: 'monospace',
      fontSize: 13,
      marginVertical: 8,
      color: t.text,
    },

    // Tables
    table: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      marginVertical: 10,
      overflow: 'hidden',
    },
    thead: {},
    tbody: {},
    th: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 10,
      fontWeight: '700',
      color: t.text,
      borderBottomWidth: 2,
      borderColor: t.border,
    },
    tr: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    td: {
      flex: 1,
      paddingVertical: 6,
      paddingHorizontal: 10,
      color: t.text,
      fontSize: 14,
    },

    // Links & misc
    link: { color: t.text, textDecorationLine: 'underline' },
    hr: { borderBottomColor: t.border, borderBottomWidth: 1, marginVertical: 12 },
    image: { display: 'none' },
    hardbreak: { width: '100%', height: 12 },
    softbreak: {},
  });
}
