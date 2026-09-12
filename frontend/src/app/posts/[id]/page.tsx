import { formatDate } from "@/lib/display-date";
import {
  getPostTimeline,
  normalizeFileViewUrl,
  normalizeMarkdownFileUrls,
} from "@/lib/api";
import type { PostDetail } from "@/lib/api";
import { notFound } from "next/navigation";
import BackButton from "@/components/BackButton";
import PostAuthorIdentity from "@/components/PostAuthorIdentity";
import { createMarkdownParser } from "@/lib/markdown";
import { requestServerJSON } from "@/lib/server-api";

interface PostPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

// Reuse one parser for requests handled by this server module.
const md = createMarkdownParser();

export default async function PostPage({ params }: PostPageProps) {
  const { id } = await params;
  const [postResult, settingsResult] = await Promise.all([
    requestServerJSON<PostDetail>(`/posts/${encodeURIComponent(id)}`),
    requestServerJSON<Record<string, string>>("/settings"),
  ]);

  if ("status" in postResult && postResult.status === 404) {
    notFound();
  }
  if (!postResult.ok || !settingsResult.ok) {
    throw new Error("Post details could not be loaded");
  }
  const post = postResult.data;
  const settings = settingsResult.data;

  const timeline = getPostTimeline(post);
  const postDateLabel = `${timeline.label} : ${formatDate(timeline.timestamp)}`;
  const authorName = settings["profile_name"]?.trim() || "admin";
  const authorTag = settings["profile_tag"]?.trim() || "admin";
  const authorAvatar = normalizeFileViewUrl(settings["profile_avatar"] || "");

  return (
    <div className="post-frame fade-in">
      <div className="post-back-floating">
        <BackButton text="←" className="post-back-button" />
      </div>
      <article className="post-detail">
        <header className="post-header">
          <h1 className="post-title">{post.title}</h1>

          <PostAuthorIdentity name={authorName} tag={authorTag} avatar={authorAvatar} />
        </header>

        <div className="post-meta post-meta-rail">
          <time className="post-date" dateTime={timeline.timestamp}>
            {postDateLabel}
          </time>
        </div>

        <section
          className="post-body custom-html-style"
          dangerouslySetInnerHTML={{
            __html: md.render(normalizeMarkdownFileUrls(post.content || "")),
          }}
        />
      </article>
      <div className="post-frame-corners" aria-hidden="true">
        <span className="post-frame-corner corner-tl">+</span>
        <span className="post-frame-corner corner-tr">+</span>
        <span className="post-frame-corner corner-bl">+</span>
        <span className="post-frame-corner corner-br">+</span>
      </div>
    </div>
  );
}

