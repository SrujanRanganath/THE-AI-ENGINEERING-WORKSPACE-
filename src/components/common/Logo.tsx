import React from 'react';
import { Layers } from 'lucide-react';
import { Link } from 'react-router-dom';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  showText?: boolean;
  to?: string;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({
  size = 'md',
  showTagline = false,
  showText = true,
  to = '/',
  className = '',
}) => {
  const iconSize = size === 'sm' ? 15 : size === 'lg' ? 20 : 17;
  const boxSize = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-10 h-10' : 'w-8 h-8';
  const textSize = size === 'sm' ? 'text-[13px]' : size === 'lg' ? 'text-lg' : 'text-sm';

  const content = (
    <div className={`inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 ${className}`}>
      <div
        className={`flex items-center justify-center ${boxSize} rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-sm shadow-violet-600/25 ring-1 ring-white/15 shrink-0`}
      >
        <Layers size={iconSize} />
      </div>
      {showText && (
        <div className="flex flex-col min-w-0">
          <span className={`font-semibold tracking-tight text-zinc-100 leading-none ${textSize}`}>
            AI Engineering
          </span>
          {showTagline && (
            <span className="text-[11px] text-zinc-400 font-medium mt-1">
              One Workspace · Four Intelligent Agents
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="inline-flex items-center whitespace-nowrap shrink-0 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-violet-500 rounded-md"
      >
        {content}
      </Link>
    );
  }

  return content;
};
