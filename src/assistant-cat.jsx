import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssistantEdge } from './floating-assistant';

function NativeCat() {
  const [dock, setDock] = useState('right');
  const [active, setActive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const presentation = event => {
      setDock(event.detail.dock === 'left' ? 'left' : 'right');
      setActive(Boolean(event.detail.active));
      setExpanded(Boolean(event.detail.expanded));
      setUnread(Number(event.detail.unread) || 0);
    };
    window.addEventListener('assistant-cat-state', presentation);
    window.ZaizaiCat?.ready();
    return () => window.removeEventListener('assistant-cat-state', presentation);
  }, []);
  return <div className="native-assistant-host is-collapsed">
    <AssistantEdge nativeDock={dock} active={active} unread={unread}
      label={expanded ? '收起助手' : '展开助手'} onOpen={() => window.ZaizaiCat?.toggle()} />
  </div>;
}

createRoot(document.getElementById('root')).render(<NativeCat />);
