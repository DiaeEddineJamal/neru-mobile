// A hidden web view that turns figures into PNGs for Word and PowerPoint, and draws the Mermaid diagram types the
// phone has no layout for. It exists only while drawings are waiting (figures.ts queues them) and a little after.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { finishJob, takeJobs, useFigureJobs } from '@/artifacts/figures';

const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="m"></div><script>
function post(o){window.ReactNativeWebView.postMessage(JSON.stringify(o))}
var loading=null;
function mermaidReady(){
  if(window.mermaid)return Promise.resolve();
  if(loading)return loading;
  loading=new Promise(function(ok,no){var s=document.createElement('script');s.src=${JSON.stringify(MERMAID_URL)};
    s.onload=function(){mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral',htmlLabels:false,flowchart:{htmlLabels:false},class:{htmlLabels:false},fontFamily:'Roboto, Arial, sans-serif'});ok()};
    s.onerror=function(){loading=null;no(new Error('offline'))};document.head.appendChild(s)});
  return loading;
}
function sized(svg){
  var doc=new DOMParser().parseFromString(svg,'image/svg+xml');var el=doc.documentElement;
  var vb=(el.getAttribute('viewBox')||'').split(/[\\s,]+/).map(Number);
  var w=Math.round(vb[2]||parseFloat(el.getAttribute('width'))||600),h=Math.round(vb[3]||parseFloat(el.getAttribute('height'))||400);
  el.setAttribute('width',w);el.setAttribute('height',h);el.removeAttribute('style');
  if(!el.getAttribute('xmlns'))el.setAttribute('xmlns','http://www.w3.org/2000/svg');
  return {svg:new XMLSerializer().serializeToString(el),w:w,h:h};
}
function raster(svg,w,h){return new Promise(function(ok,no){
  var scale=Math.max(1,Math.min(2.5,3000/Math.max(w,h)));var img=new Image();
  img.onload=function(){try{var c=document.createElement('canvas');c.width=Math.round(w*scale);c.height=Math.round(h*scale);
    var g=c.getContext('2d');g.fillStyle='#ffffff';g.fillRect(0,0,c.width,c.height);g.drawImage(img,0,0,c.width,c.height);
    ok(c.toDataURL('image/png').split(',')[1])}catch(e){no(e)}};
  img.onerror=function(){no(new Error('image'))};
  img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)})}
window.neruDraw=function(job){(async function(){try{
  var svg=job.svg;
  if(job.mermaid){await mermaidReady();svg=(await mermaid.render('f'+job.id,job.mermaid)).svg}
  var s=sized(svg);var png=job.png?await raster(s.svg,s.w,s.h):undefined;
  post({id:job.id,svg:s.svg,width:s.w,height:s.h,png:png});
}catch(e){post({id:job.id,error:String(e&&e.message||e)})}})()};
post({ready:true});
</script></body></html>`;

/** Mount once near the app root. Renders nothing until a drawing is queued. */
export function FigureHost() {
  const waiting = useFigureJobs();
  const [alive, setAlive] = useState(false);
  const ready = useRef(false);
  const sent = useRef(new Set<number>());
  const view = useRef<WebView>(null);

  // Keep the web view a while after the last job, so an export with several figures loads it once.
  useEffect(() => {
    if (waiting > 0) return setAlive(true);
    const timer = setTimeout(() => {
      setAlive(false);
      ready.current = false;
      sent.current.clear();
    }, 30_000);
    return () => clearTimeout(timer);
  }, [waiting]);

  const send = () => {
    if (!ready.current) return;
    for (const job of takeJobs()) {
      if (sent.current.has(job.id)) continue;
      sent.current.add(job.id);
      view.current?.injectJavaScript(`window.neruDraw(${JSON.stringify({ id: job.id, svg: job.svg, mermaid: job.mermaid, png: job.png }).replace(/</g, '\\u003c')});true;`);
    }
  };
  useEffect(send, [waiting]);

  const onMessage = (e: WebViewMessageEvent) => {
    let data: { ready?: boolean; id?: number; svg?: string; width?: number; height?: number; png?: string; error?: string };
    try {
      data = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (data.ready) {
      ready.current = true;
      send();
    } else if (typeof data.id === 'number') finishJob(data.id, data);
  };

  if (!alive) return null;
  return (
    <View pointerEvents="none" style={s.hidden} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <WebView
        ref={view}
        source={{ html: PAGE }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={onMessage}
        onShouldStartLoadWithRequest={req => /^(about:|data:|blob:)/i.test(req.url) || req.url.startsWith(MERMAID_URL)}
        allowFileAccess={false}
        incognito
        cacheEnabled
        style={{ width: 400, height: 300 }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  hidden: { position: 'absolute', left: -1000, top: 0, width: 400, height: 300, opacity: 0 },
});
