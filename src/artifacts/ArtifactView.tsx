// Renders an artifact full screen (viewer) or as a small static preview (Artifacts list).
// HTML, SVG and Mermaid run in a sandboxed WebView: no file access, JavaScript only for HTML pages and the Mermaid
// renderer, and every navigation away from the page is blocked; http(s), mailto and tel links open outside the app.
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { needsHost, renderFigures } from '@/artifacts/figures';
import { deckHtml, documentHtml, sheetHtml, sheetPreview, type Figures } from '@/artifacts/html';
import { displayTitle, iconFor } from '@/artifacts/kinds';
import type { Artifact } from '@/artifacts/parse';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import { t } from '@/i18n';
import { font, fs, useBottomPad, useColors, useScheme } from '@/theme';
import { tokenize, vscode } from '@/ui/highlight';

/** Mermaid comes from a CDN at a pinned version; offline, the diagram falls back to its source. */
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';

/** A complete page for the WebView: fragments are wrapped, and a page without a viewport gets one. */
export function pageHtml(content: string): string {
  if (/^\s*(?:<!--[\s\S]*?-->\s*)?(?:<!doctype\s+html|<html[\s>])/i.test(content)) {
    if (/<meta[^>]+name=["']?viewport/i.test(content)) return content;
    return /<head[^>]*>/i.test(content) ? content.replace(/<head[^>]*>/i, m => m + VIEWPORT) : content.replace(/<html[^>]*>/i, m => `${m}<head>${VIEWPORT}</head>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${VIEWPORT}<style>body{font-family:system-ui,sans-serif;margin:16px;line-height:1.5}</style></head><body>${content}</body></html>`;
}

function svgHtml(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${VIEWPORT}<style>html,body{margin:0;height:100%;background:#fff}body{display:flex;align-items:center;justify-content:center}svg{max-width:100%;max-height:100vh;height:auto}</style></head><body>${content}</body></html>`;
}

export function mermaidHtml(code: string, dark: boolean): string {
  const source = JSON.stringify(code).replace(/</g, '\\u003c');
  const bg = dark ? '#151515' : '#ffffff';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${VIEWPORT}<style>html,body{margin:0;background:${bg}}#d{padding:16px;display:flex;justify-content:center}#d svg{max-width:100%;height:auto}</style></head><body><div id="d"></div>
<script>function post(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(m)}</script>
<script src="${MERMAID_URL}" onerror="post('offline')"></script>
<script>
try{mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:${dark ? "'dark'" : "'default'"}});
mermaid.render('m',${source}).then(function(r){document.getElementById('d').innerHTML=r.svg;post('ok')}).catch(function(e){post('error:'+(e&&e.message||e))});}
catch(e){post(typeof mermaid==='undefined'?'offline':'error:'+e.message)}
</script></body></html>`;
}

const ALLOWED = /^(?:about:|data:|blob:)/i;
const EXTERNAL = /^(?:https?:|mailto:|tel:)/i;

/** Keeps the WebView on its own document; real links open in the browser or the matching app. */
function onNavigate(req: ShouldStartLoadRequest): boolean {
  if (ALLOWED.test(req.url)) return true;
  if (EXTERNAL.test(req.url) && req.isTopFrame !== false) void Linking.openURL(req.url).catch(() => undefined);
  return false;
}

type SandboxProps = { html: string; js: boolean; onMessage?: (data: string) => void; style?: StyleProp<ViewStyle>; background?: string; interactive?: boolean };

/** A WebView locked down for model-written content, fading in once loaded. */
export function Sandbox({ html, js, onMessage, style, background = '#ffffff', interactive = true }: SandboxProps) {
  const opacity = useSharedValue(0);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View style={[{ flex: 1, backgroundColor: background }, fade, style]} pointerEvents={interactive ? 'auto' : 'none'}>
      <WebView
        source={{ html }}
        originWhitelist={['*']}
        onShouldStartLoadWithRequest={onNavigate}
        javaScriptEnabled={js}
        domStorageEnabled={js}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        mixedContentMode="never"
        geolocationEnabled={false}
        mediaPlaybackRequiresUserAction
        thirdPartyCookiesEnabled={false}
        incognito
        cacheEnabled={false}
        overScrollMode="never"
        scrollEnabled={interactive}
        showsVerticalScrollIndicator={interactive}
        showsHorizontalScrollIndicator={false}
        setBuiltInZoomControls={interactive}
        setDisplayZoomControls={false}
        onMessage={onMessage ? (e: WebViewMessageEvent) => onMessage(e.nativeEvent.data) : undefined}
        onLoadEnd={() => opacity.set(withTiming(1, { duration: 220 }))}
        style={{ flex: 1, backgroundColor: background }}
      />
    </Animated.View>
  );
}

/**
 * Scroll props that keep the newest text in view while `follow` is on (an artifact being written), the way a terminal
 * tails its output. Scrolling up to read pauses it; scrolling back to the end resumes it.
 */
function useFollow(follow: boolean) {
  const ref = useRef<ScrollView>(null);
  const atEnd = useRef(true);
  return {
    ref,
    scrollEventThrottle: 64,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      atEnd.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
    },
    onContentSizeChange: () => {
      if (follow && atEnd.current) ref.current?.scrollToEnd({ animated: false });
    },
  };
}

/** Full-height code with line numbers and syntax colours. `follow`: keep the last line in view as code arrives. */
export function CodeView({ code, lang, follow = false }: { code: string; lang: string; follow?: boolean }) {
  const c = useColors();
  const palette = vscode[useScheme()];
  const bottom = useBottomPad();
  const tail = useFollow(follow);
  const lines = useMemo(() => tokenize(code, lang), [code, lang]);
  const gutter = String(lines.length).length * 8 + 16;
  const line = { fontFamily: font.mono, fontSize: fs.xs, lineHeight: 20, fontVariant: ['no-common-ligatures', 'no-contextual'] as ('no-common-ligatures' | 'no-contextual')[] };
  return (
    <ScrollView {...tail} style={{ flex: 1, backgroundColor: c.surface2 }} contentContainerStyle={{ paddingVertical: 12, paddingBottom: bottom + 24 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {lines.map((tokens, i) => (
            <View key={i} style={{ flexDirection: 'row', minHeight: 20 }}>
              <Text aria-hidden style={[line, { width: gutter, paddingRight: 12, textAlign: 'right', color: c.muted, opacity: 0.5 }]}>{i + 1}</Text>
              <Text selectable style={[line, { color: palette.plain, paddingRight: 24 }]}>
                {tokens.map((tk, j) => <Text key={j} style={tk.kind === 'comment' ? { color: palette.comment, fontStyle: 'italic' } : { color: palette[tk.kind] }}>{tk.text}</Text>)}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

function MermaidView({ code }: { code: string }) {
  const c = useColors();
  const dark = useScheme() === 'dark';
  const [state, setState] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    timer.current = setTimeout(() => setState(s => (s === 'loading' ? 'offline' : s)), 12000);
    return () => clearTimeout(timer.current);
  }, [code]);
  const html = useMemo(() => mermaidHtml(code, dark), [code, dark]);
  if (state === 'offline' || state === 'error') {
    return (
      <View style={{ flex: 1 }}>
        <View style={[s.notice, { backgroundColor: c.surface3 }]}>
          <Icon name="info" size={16} color={c.muted} />
          <Text style={{ flex: 1, fontFamily: font.medium, fontSize: fs.sm, color: c.secondary }}>
            {state === 'offline' ? t('Connect to the internet to draw this diagram. Showing its source.') : t('This diagram has an error. Showing its source.')}
          </Text>
        </View>
        <CodeView code={code} lang="mermaid" />
      </View>
    );
  }
  return <Sandbox html={html} js background={c.bg} onMessage={m => setState(m === 'ok' ? 'ok' : m === 'offline' ? 'offline' : 'error')} />;
}

/**
 * Mermaid diagrams of types the phone has no layout for (Gantt, class, ER…), drawn by the hidden web view once the
 * artifact is written. Charts and the common diagrams are drawn straight into the page, so most texts need none.
 */
function useHostFigures(artifact: Artifact, active: boolean): Figures | undefined {
  const [figures, setFigures] = useState<{ content: string; map: Figures }>();
  useEffect(() => {
    if (!active || !needsHost(artifact.content)) return;
    let live = true;
    void renderFigures(artifact.content, false).then(map => live && setFigures({ content: artifact.content, map }));
    return () => {
      live = false;
    };
  }, [artifact.content, active]);
  return figures?.content === artifact.content ? figures.map : undefined;
}

/** The artifact itself, filling the screen. `follow`: it is being written, so keep its end in view. */
export function ArtifactBody({ artifact, follow = false }: { artifact: Artifact; follow?: boolean }) {
  const c = useColors();
  const bottom = useBottomPad();
  const tail = useFollow(follow);
  // A Word or PDF document shows on paper once it is written; while it is being written, as live Markdown.
  const paper = artifact.kind === 'markdown' && !!artifact.format && !follow;
  const figures = useHostFigures(artifact, paper || (artifact.kind === 'slides' && !follow));
  const html = useMemo(() => {
    if (artifact.kind === 'html') return pageHtml(artifact.content);
    if (artifact.kind === 'svg') return svgHtml(artifact.content);
    if (artifact.kind === 'slides') return deckHtml(artifact, figures);
    if (artifact.kind === 'sheet') return sheetHtml(artifact);
    if (paper) return documentHtml(artifact, figures);
    return '';
  }, [artifact, paper, figures]);
  if (paper) return <Sandbox html={html} js={false} background="#e9ece9" />;
  switch (artifact.kind) {
    case 'html':
      return <Sandbox html={html} js />;
    case 'slides':
      return <Sandbox html={html} js={false} background="#e9ece9" />;
    case 'sheet':
      return <Sandbox html={html} js={false} />;
    case 'svg':
      return <Sandbox html={html} js={false} />;
    case 'mermaid':
      return <MermaidView code={artifact.content} />;
    case 'code':
      return <CodeView code={artifact.content} lang={artifact.language ?? ''} follow={follow} />;
    case 'markdown':
      return (
        <ScrollView {...tail} style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: bottom + 32 }}>
          <Animated.View entering={FadeIn.duration(220)}>
            <Markdown text={artifact.content} />
          </Animated.View>
        </ScrollView>
      );
  }
}

// ---- Thumbnails for the Artifacts list ----

export const THUMB_W = 136;
export const THUMB_H = 104;
const PAGE_W = 390;
const SCALE = THUMB_W / PAGE_W;

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const strip = (md: string) => md.replace(/```[\s\S]*?(```|$)/g, '').replace(/[#>*_`|]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

/** A small static preview. Web pages render in a scaled, non-interactive WebView only while `visible`. */
export function ArtifactThumb({ artifact, visible }: { artifact: Artifact; visible: boolean }) {
  const c = useColors();
  const html = useMemo(() => (artifact.kind === 'html' ? pageHtml(artifact.content) : ''), [artifact.kind, artifact.content]);
  let body: ReactNode;
  if (artifact.kind === 'html') {
    body = visible ? (
      <View style={{ width: PAGE_W, height: THUMB_H / SCALE, transform: [{ scale: SCALE }], transformOrigin: 'top left' }}>
        <Sandbox html={html} js interactive={false} />
      </View>
    ) : null;
  } else if (artifact.kind === 'svg') {
    const fallback = <View style={s.center}><Icon name="photo" size={28} color="#888" /></View>;
    body = (
      <Boundary fallback={fallback}>
        <View style={[s.center, { padding: 8 }]}>
          <SvgXml xml={artifact.content} width="100%" height="100%" onError={() => undefined} fallback={fallback} />
        </View>
      </Boundary>
    );
  } else if (artifact.kind === 'slides') {
    body = (
      <View style={[s.center, { backgroundColor: '#1F3A2E', padding: 10 }]}>
        <Text numberOfLines={3} style={{ fontFamily: font.semibold, fontSize: 12, lineHeight: 15, color: '#ffffff', textAlign: 'center' }}>{displayTitle(artifact)}</Text>
        <View style={{ width: 22, height: 2, backgroundColor: '#CFE3D6', marginTop: 6 }} />
      </View>
    );
  } else if (artifact.kind === 'sheet') {
    body = (
      <View style={{ padding: 6 }}>
        {sheetPreview(artifact).map((row, i) => (
          <View key={i} style={{ flexDirection: 'row', backgroundColor: i === 0 ? '#3E7A5A' : 'transparent' }}>
            {row.map((cell, j) => (
              <Text key={j} numberOfLines={1} style={{ flex: 1, fontFamily: font.sans, fontSize: 6.5, lineHeight: 11, paddingHorizontal: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: '#d5dcd7', color: i === 0 ? '#ffffff' : '#333333' }}>{cell}</Text>
            ))}
          </View>
        ))}
      </View>
    );
  } else if (artifact.kind === 'markdown') {
    const lines = strip(artifact.content).split('\n').map(l => l.trim()).filter(Boolean);
    body = (
      <View style={{ padding: 8, gap: 3 }}>
        <Text numberOfLines={2} style={{ fontFamily: font.serif, fontSize: 11, lineHeight: 13, color: '#1a1a1a' }}>{lines[0] ?? ''}</Text>
        <Text numberOfLines={6} style={{ fontFamily: font.sans, fontSize: 7, lineHeight: 9.5, color: '#444' }}>{lines.slice(1, 14).join('\n')}</Text>
      </View>
    );
  } else {
    body = (
      <Text numberOfLines={11} style={{ padding: 8, fontFamily: font.mono, fontSize: 6.5, lineHeight: 8.5, color: c.secondary }}>
        {artifact.content.split('\n').slice(0, 14).join('\n')}
      </Text>
    );
  }
  const paper = artifact.kind === 'html' || artifact.kind === 'svg' || artifact.kind === 'markdown' || artifact.kind === 'sheet';
  return (
    <View style={[s.thumb, { backgroundColor: paper ? '#ffffff' : c.surface3, borderColor: c.border }]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {body}
      <View style={[s.badge, { backgroundColor: c.surface2, borderColor: c.border }]}>
        <Icon name={iconFor(artifact)} size={18} color={c.text} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  thumb: { width: THUMB_W, height: THUMB_H, borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', left: 6, bottom: 6, width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
