"use client";

import { useMemo, useState } from "react";

interface PostAuthorIdentityProps {
  name: string;
  tag: string;
  avatar: string;
}

export default function PostAuthorIdentity({ name, tag, avatar }: PostAuthorIdentityProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const initial = useMemo(() => (name || "A").trim().charAt(0).toUpperCase() || "A", [name]);
  const showAvatarImage = !!avatar && !imageFailed;

  return (
    <div className="post-author-row">
      <span className="post-author-avatar">
        {showAvatarImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt={name}
            className="post-author-avatar-image"
            onError={() => setImageFailed(true)}
          />
        ) : (
          initial
        )}
      </span>
      <span className="post-author-name">{name}</span>
      <span className="post-author-role">{tag}</span>
    </div>
  );
}
