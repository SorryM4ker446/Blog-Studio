import {
  getPost,
  getSettings,
  normalizeFileViewUrl,
  normalizeMarkdownFileUrls,
} from "@/lib/api";
import type { Post } from "@/lib/api";
import { notFound } from "next/navigation";
import BackButton from "@/components/BackButton";
import PostAuthorIdentity from "@/components/PostAuthorIdentity";

interface PostPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

// Pre-initialize markdown-it to avoid repeated require calls during render
const MarkdownIt = require("markdown-it");
const { imageSizePlugin } = require("@/lib/md-plugins");
const md = new MarkdownIt({ html: false }).use(imageSizePlugin);

export default async function PostPage({ params }: PostPageProps) {
  const { id } = await params;
  const [post, settings] = await Promise.all([getPost(id), getSettings()]);

  if (!post) {
    notFound();
  }

  const updatedDate = new Date(post.updated_at);
  const yyyy = updatedDate.getFullYear();
  const mm = String(updatedDate.getMonth() + 1).padStart(2, "0");
  const dd = String(updatedDate.getDate()).padStart(2, "0");
  const postDateLabel = `Updated : ${yyyy}/${mm}/${dd}`;
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
          <time className="post-date" dateTime={post.updated_at}>
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

