import React from 'react';

export function UserAvatar({ user, className = '' }) {
  return <span className={`account-user-avatar ${className}`} aria-hidden="true">
    <span>{user.name.slice(0, 1)}</span>
    {user.avatar && <img key={user.avatar} src={user.avatar} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />}
  </span>;
}
