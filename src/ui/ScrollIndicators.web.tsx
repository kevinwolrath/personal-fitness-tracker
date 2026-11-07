/** One browser rule also covers the document, portals and multiline editable fields. */
export function ScrollIndicators() {
  return <style id="body-anvil-scroll-indicators">{`
    html, body, * { scrollbar-width: none; -ms-overflow-style: none; }
    *::-webkit-scrollbar { display: none; width: 0; height: 0; }
  `}</style>;
}
