import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { Chessboard } from 'react-chessboard';

export default function ResponsiveBoard(props: Omit<ComponentProps<typeof Chessboard>, 'boardWidth'>) {
  'use memo';
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={container} className="responsive-board" data-testid="responsive-board">
    {width > 0 && <Chessboard {...props} boardWidth={width} />}
  </div>;
}
