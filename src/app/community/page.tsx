"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth, supabaseAuth } from "@/lib/auth";
import AuthModal from "../components/AuthModal";

const CATEGORIES = [
  { key: "all", label: "전체" },
  { key: "정유사정보", label: "정유사/대리점" },
  { key: "운영고민", label: "운영 고민" },
  { key: "장비추천", label: "장비/시설" },
  { key: "구인구직", label: "구인구직" },
  { key: "자유", label: "자유게시판" },
];

const CATEGORY_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  정유사정보: { bg: "bg-blue-50", text: "text-blue-600", dot: "#3B82F6" },
  운영고민: { bg: "bg-amber-50", text: "text-amber-600", dot: "#F59E0B" },
  장비추천: { bg: "bg-emerald-50", text: "text-emerald-600", dot: "#10B981" },
  구인구직: { bg: "bg-purple-50", text: "text-purple-600", dot: "#8B5CF6" },
  자유: { bg: "bg-gray-50", text: "text-gray-500", dot: "#9CA3AF" },
};

interface Post {
  id: string;
  author_id: string;
  category: string;
  title: string;
  content: string;
  likes_count: number;
  comments_count: number;
  created_at: string;
  author: { nickname: string } | null;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(dateStr).toLocaleDateString("ko-KR");
}

function CategoryBadge({ category }: { category: string }) {
  const style = CATEGORY_STYLES[category] || CATEGORY_STYLES["자유"];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full ${style.bg} ${style.text}`}>
      <span className="w-[5px] h-[5px] rounded-full" style={{ background: style.dot }} />
      {category}
    </span>
  );
}

// ── 공통 헤더 ──
function PageHeader({ rightSlot }: { rightSlot: React.ReactNode }) {
  return (
    <header className="h-[56px] bg-navy flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-2">
        <Link href="/" className="flex items-center gap-2 no-underline shrink-0">
          <div className="w-7 h-7 bg-emerald rounded-lg flex items-center justify-center">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
          <span className="text-white text-[16px] font-bold tracking-tight hidden md:block">주유소맵</span>
        </Link>
        <nav className="flex items-center gap-0.5 ml-1">
          <Link href="/" className="px-3 py-1.5 text-[13px] font-medium text-gray-400 hover:text-white hover:bg-white/10 rounded-lg no-underline transition-colors">지도</Link>
          <Link href="/community" className="px-3 py-1.5 text-[13px] font-medium text-white bg-white/15 rounded-lg no-underline">커뮤니티</Link>
        </nav>
      </div>
      {rightSlot}
    </header>
  );
}

export default function CommunityPage() {
  const { user, profile, signOut } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [category, setCategory] = useState("all");
  const [posts, setPosts] = useState<Post[]>([]);
  const [topPosts, setTopPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"latest" | "popular" | "comments">("latest");

  const [showWrite, setShowWrite] = useState(false);
  const [writeCategory, setWriteCategory] = useState("자유");
  const [writeTitle, setWriteTitle] = useState("");
  const [writeContent, setWriteContent] = useState("");
  const [writeLoading, setWriteLoading] = useState(false);

  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [postDetail, setPostDetail] = useState<{
    post: Post;
    comments: Array<{ id: string; content: string; created_at: string; author: { id: string; nickname: string } | null }>;
    liked: boolean;
  } | null>(null);
  const [commentText, setCommentText] = useState("");

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const orderCol = sortBy === "popular" ? "likes_count" : sortBy === "comments" ? "comments_count" : "created_at";
    let query = supabaseAuth
      .from("posts")
      .select("id, author_id, category, title, content, likes_count, comments_count, created_at, author:users_profile!author_id(nickname)")
      .order(orderCol, { ascending: false })
      .limit(50);
    if (category !== "all") query = query.eq("category", category);
    if (searchQuery.trim()) query = query.or(`title.ilike.%${searchQuery.trim()}%,content.ilike.%${searchQuery.trim()}%`);
    const { data } = await query;
    setPosts((data as unknown as Post[]) || []);
    setLoading(false);
  }, [category, sortBy, searchQuery]);

  const fetchTopPosts = useCallback(async () => {
    const { data } = await supabaseAuth
      .from("posts")
      .select("id, author_id, category, title, content, likes_count, comments_count, created_at, author:users_profile!author_id(nickname)")
      .order("likes_count", { ascending: false })
      .limit(3);
    setTopPosts((data as unknown as Post[]) || []);
  }, []);

  const refreshAll = useCallback(() => { fetchPosts(); fetchTopPosts(); }, [fetchPosts, fetchTopPosts]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const orderCol = sortBy === "popular" ? "likes_count" : sortBy === "comments" ? "comments_count" : "created_at";
      let query = supabaseAuth
        .from("posts")
        .select("id, author_id, category, title, content, likes_count, comments_count, created_at, author:users_profile!author_id(nickname)")
        .order(orderCol, { ascending: false })
        .limit(50);
      if (category !== "all") query = query.eq("category", category);
      if (searchQuery.trim()) query = query.or(`title.ilike.%${searchQuery.trim()}%,content.ilike.%${searchQuery.trim()}%`);
      setLoading(true);
      const [postsRes, topRes] = await Promise.all([
        query,
        supabaseAuth
          .from("posts")
          .select("id, author_id, category, title, content, likes_count, comments_count, created_at, author:users_profile!author_id(nickname)")
          .order("likes_count", { ascending: false })
          .limit(3),
      ]);
      if (cancelled) return;
      setPosts((postsRes.data as unknown as Post[]) || []);
      setTopPosts((topRes.data as unknown as Post[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [category, sortBy, searchQuery]);

  const handleWrite = async () => {
    if (!user || !writeTitle.trim() || !writeContent.trim()) return;
    setWriteLoading(true);
    const { error } = await supabaseAuth.from("posts").insert({ author_id: user.id, category: writeCategory, title: writeTitle.trim(), content: writeContent.trim() });
    setWriteLoading(false);
    if (!error) { setShowWrite(false); setWriteTitle(""); setWriteContent(""); refreshAll(); }
  };

  const openPost = async (post: Post) => {
    setSelectedPost(post);
    const { data: comments } = await supabaseAuth.from("comments").select("id, content, created_at, author:users_profile!author_id(id, nickname)").eq("post_id", post.id).order("created_at", { ascending: true });
    let liked = false;
    if (user) { const { data } = await supabaseAuth.from("post_likes").select("post_id").eq("post_id", post.id).eq("user_id", user.id).maybeSingle(); liked = !!data; }
    setPostDetail({ post, comments: (comments as unknown as NonNullable<typeof postDetail>["comments"]) || [], liked });
  };

  const toggleLike = async () => {
    if (!user || !postDetail) return;
    if (postDetail.liked) await supabaseAuth.from("post_likes").delete().eq("post_id", postDetail.post.id).eq("user_id", user.id);
    else await supabaseAuth.from("post_likes").insert({ post_id: postDetail.post.id, user_id: user.id });
    await openPost(postDetail.post); refreshAll();
  };

  const addComment = async () => {
    if (!user || !postDetail || !commentText.trim()) return;
    await supabaseAuth.from("comments").insert({ post_id: postDetail.post.id, author_id: user.id, content: commentText.trim() });
    setCommentText(""); await openPost(postDetail.post); refreshAll();
  };

  const deletePost = async (postId: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await supabaseAuth.from("posts").delete().eq("id", postId);
    setSelectedPost(null); setPostDetail(null); refreshAll();
  };

  const deleteComment = async (commentId: string) => {
    if (!confirm("댓글을 삭제하시겠습니까?")) return;
    await supabaseAuth.from("comments").delete().eq("id", commentId);
    if (postDetail) await openPost(postDetail.post); refreshAll();
  };

  // ── 비로그인 ──
  if (!user) {
    return (
      <div className="min-h-screen bg-surface flex flex-col">
        <PageHeader rightSlot={
          <button onClick={() => setShowAuth(true)} className="h-8 px-4 text-[13px] font-semibold text-white bg-emerald hover:bg-emerald/90 rounded-lg border-none cursor-pointer transition-colors">로그인</button>
        } />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <div className="w-20 h-20 bg-navy/5 rounded-3xl flex items-center justify-center mx-auto mb-5">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#1B2838" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <h2 className="text-[22px] font-bold text-text-primary mb-2">커뮤니티</h2>
            <p className="text-[14px] text-text-secondary mb-8 leading-relaxed">주유소 사장님들의 정보 공유 공간입니다.<br/>로그인 후 이용할 수 있습니다.</p>
            <button onClick={() => setShowAuth(true)} className="h-12 px-8 bg-navy text-white text-[14px] font-semibold rounded-[12px] border-none cursor-pointer hover:bg-navy-light transition-colors">로그인하기</button>
          </div>
        </div>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </div>
    );
  }

  // ── 게시글 상세 ──
  if (selectedPost && postDetail) {
    return (
      <div className="min-h-screen bg-surface flex flex-col">
        <PageHeader rightSlot={
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-gray-400 hidden md:inline">{profile?.nickname}</span>
            <button onClick={signOut} className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-white bg-white/10 rounded-lg border-none cursor-pointer transition-colors">로그아웃</button>
          </div>
        } />
        <div className="max-w-2xl mx-auto w-full px-4 py-5 flex-1">
          <button onClick={() => { setSelectedPost(null); setPostDetail(null); }} className="flex items-center gap-1.5 text-[13px] text-text-tertiary hover:text-text-primary bg-transparent border-none cursor-pointer mb-5 p-0 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            목록으로
          </button>

          <article className="bg-white rounded-[16px] border border-border overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <CategoryBadge category={postDetail.post.category} />
                <span className="text-[11px] text-text-tertiary">{timeAgo(postDetail.post.created_at)}</span>
              </div>
              <h1 className="text-[20px] font-bold text-text-primary m-0 mb-2 leading-tight">{postDetail.post.title}</h1>
              <div className="flex items-center gap-2 mb-5">
                <div className="w-6 h-6 bg-emerald/10 text-emerald rounded-full flex items-center justify-center text-[11px] font-bold">
                  {((postDetail.post.author as { nickname: string } | null)?.nickname || "?")[0]}
                </div>
                <span className="text-[13px] font-medium text-text-primary">{(postDetail.post.author as { nickname: string } | null)?.nickname || "알 수 없음"}</span>
              </div>
              <div className="text-[14px] text-text-secondary leading-[1.75] whitespace-pre-wrap">{postDetail.post.content}</div>
            </div>

            <div className="px-6 py-3 border-t border-border flex items-center gap-3">
              <button onClick={toggleLike} className={`flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12px] font-medium border cursor-pointer transition-all ${postDetail.liked ? "bg-coral-light text-coral border-coral/20" : "bg-transparent text-text-tertiary border-border hover:bg-surface"}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill={postDetail.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                좋아요 {postDetail.post.likes_count}
              </button>
              {user.id === postDetail.post.author_id && (
                <button onClick={() => deletePost(postDetail.post.id)} className="ml-auto text-[12px] text-text-tertiary hover:text-coral bg-transparent border-none cursor-pointer transition-colors">삭제</button>
              )}
            </div>
          </article>

          {/* 댓글 */}
          <section className="mt-4 bg-white rounded-[16px] border border-border overflow-hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-[14px] font-bold text-text-primary m-0">댓글 <span className="text-emerald">{postDetail.comments.length}</span></h3>
            </div>

            {postDetail.comments.length === 0 && (
              <div className="px-6 py-8 text-center"><p className="text-[13px] text-text-tertiary m-0">아직 댓글이 없습니다. 첫 댓글을 남겨보세요!</p></div>
            )}

            {postDetail.comments.map((c) => (
              <div key={c.id} className="px-6 py-4 border-b border-border last:border-0">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-surface text-text-tertiary rounded-full flex items-center justify-center text-[10px] font-bold">{(c.author?.nickname || "?")[0]}</div>
                    <span className="text-[12px] font-semibold text-text-primary">{c.author?.nickname || "알 수 없음"}</span>
                    <span className="text-[11px] text-text-tertiary">{timeAgo(c.created_at)}</span>
                  </div>
                  {user.id === c.author?.id && (
                    <button onClick={() => deleteComment(c.id)} className="text-[11px] text-text-tertiary hover:text-coral bg-transparent border-none cursor-pointer transition-colors">삭제</button>
                  )}
                </div>
                <p className="text-[13px] text-text-secondary m-0 ml-7 leading-relaxed">{c.content}</p>
              </div>
            ))}

            <div className="p-4 border-t border-border flex gap-2">
              <input type="text" value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="댓글을 입력하세요" className="flex-1 h-10 px-3 text-[13px] border border-border rounded-[10px] outline-none focus:border-navy bg-white text-text-primary transition-colors" onKeyDown={(e) => e.key === "Enter" && addComment()} />
              <button onClick={addComment} disabled={!commentText.trim()} className="h-10 px-5 bg-navy text-white text-[12px] font-semibold rounded-[10px] border-none cursor-pointer hover:bg-navy-light disabled:opacity-30 transition-all">등록</button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // ── 게시글 목록 ──
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <PageHeader rightSlot={
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-gray-400 hidden md:inline">{profile?.nickname}</span>
          <button onClick={signOut} className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-white bg-white/10 rounded-lg border-none cursor-pointer transition-colors">로그아웃</button>
        </div>
      } />

      <div className="max-w-2xl mx-auto w-full px-4 py-4 flex-1">
        {/* 배너 */}
        <div className="bg-navy rounded-[16px] p-5 mb-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald/10 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative">
            <h2 className="text-[18px] font-bold text-white m-0 mb-1">주유소 사장님들의 소통 공간</h2>
            <p className="text-[13px] text-gray-400 m-0">정보 공유, 운영 노하우, 장비 추천까지</p>
          </div>
        </div>

        {/* 인기글 TOP 3 (가로 스크롤 카드) */}
        {topPosts.length > 0 && category === "all" && !searchQuery && sortBy === "latest" && (
          <div className="mb-4">
            <h3 className="text-[13px] font-bold text-text-primary mb-2 flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#FF5252"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
              인기글
            </h3>
            <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1">
              {topPosts.map((post, i) => (
                <div
                  key={post.id}
                  onClick={() => openPost(post)}
                  className="shrink-0 w-[220px] bg-white rounded-[14px] p-4 border border-border cursor-pointer transition-lift"
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[18px] font-black text-coral/30">{i + 1}</span>
                    <CategoryBadge category={post.category} />
                  </div>
                  <p className="text-[13px] font-semibold text-text-primary m-0 mb-2 line-clamp-2 leading-snug">{post.title}</p>
                  <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
                    <span className="flex items-center gap-0.5">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                      {post.likes_count}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      {post.comments_count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 검색 + 필터 */}
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9BA8B7" strokeWidth="2.5"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input type="text" placeholder="검색" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-9 pl-9 pr-3 text-[13px] bg-white border border-border rounded-[10px] outline-none focus:border-navy text-text-primary transition-colors" />
          </div>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "latest" | "popular" | "comments")} className="h-9 px-2.5 text-[12px] bg-white border border-border rounded-[10px] outline-none text-text-secondary cursor-pointer">
            <option value="latest">최신순</option>
            <option value="popular">인기순</option>
            <option value="comments">댓글순</option>
          </select>
        </div>

        {/* 카테고리 칩 */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide mb-4 pb-0.5">
          {CATEGORIES.map((c) => (
            <button key={c.key} onClick={() => setCategory(c.key)} className={`shrink-0 h-8 px-3.5 text-[12px] font-medium rounded-full border cursor-pointer transition-all ${category === c.key ? "bg-navy text-white border-navy" : "bg-white text-text-secondary border-border hover:border-text-tertiary"}`}>
              {c.label}
            </button>
          ))}
        </div>

        {/* 글쓰기 FAB */}
        <button onClick={() => setShowWrite(true)} className="fixed bottom-6 right-6 md:bottom-8 md:right-8 z-[100] w-14 h-14 bg-emerald text-white rounded-2xl border-none cursor-pointer flex items-center justify-center hover:bg-emerald/90 transition-colors" style={{ boxShadow: "0 4px 16px rgba(0,192,115,0.3)" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
        </button>

        {/* 게시글 목록 */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-[14px] p-4 border border-border">
                <div className="skeleton h-3 w-16 mb-3" />
                <div className="skeleton h-4 w-3/4 mb-2" />
                <div className="skeleton h-3 w-full mb-3" />
                <div className="skeleton h-3 w-1/3" />
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.2" className="mb-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <p className="text-[15px] font-medium text-text-tertiary m-0 mb-1">아직 게시글이 없습니다</p>
            <p className="text-[13px] text-text-tertiary/60 m-0">첫 번째 글을 작성해보세요!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {posts.map((post) => (
              <div key={post.id} onClick={() => openPost(post)} className="bg-white rounded-[14px] p-4 border border-border cursor-pointer transition-lift hover:border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <CategoryBadge category={post.category} />
                  <span className="text-[11px] text-text-tertiary ml-auto">{timeAgo(post.created_at)}</span>
                </div>
                <h3 className="text-[15px] font-semibold text-text-primary m-0 mb-1 line-clamp-2 leading-snug">{post.title}</h3>
                <p className="text-[13px] text-text-tertiary m-0 mb-3 line-clamp-2 leading-relaxed">{post.content}</p>
                <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 bg-surface rounded-full flex items-center justify-center text-[8px] font-bold text-text-tertiary">{((post.author as { nickname: string } | null)?.nickname || "?")[0]}</div>
                    <span className="font-medium text-text-secondary">{(post.author as { nickname: string } | null)?.nickname || "알 수 없음"}</span>
                  </div>
                  <div className="flex items-center gap-0.5 ml-auto">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                    {post.likes_count}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    {post.comments_count}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 글쓰기 모달 */}
      {showWrite && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-4" onClick={() => setShowWrite(false)}>
          <div className="bg-white rounded-[20px] w-full max-w-[500px] overflow-hidden" style={{ boxShadow: "var(--shadow-xl)" }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 flex items-center justify-between border-b border-border">
              <h2 className="text-[17px] font-bold text-text-primary m-0">새 글 작성</h2>
              <button onClick={() => setShowWrite(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface bg-transparent border-none cursor-pointer transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9BA8B7" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[12px] font-semibold text-text-secondary mb-2 block">카테고리</label>
                <div className="flex gap-1.5 flex-wrap">
                  {CATEGORIES.filter((c) => c.key !== "all").map((c) => (
                    <button key={c.key} onClick={() => setWriteCategory(c.key)} className={`h-8 px-3 text-[12px] font-medium rounded-full border cursor-pointer transition-all ${writeCategory === c.key ? "bg-navy text-white border-navy" : "bg-white text-text-secondary border-border hover:border-text-tertiary"}`}>{c.label}</button>
                  ))}
                </div>
              </div>
              <input type="text" placeholder="제목을 입력하세요" value={writeTitle} onChange={(e) => setWriteTitle(e.target.value)} className="w-full h-11 px-4 text-[15px] font-semibold border border-border rounded-[12px] outline-none focus:border-navy bg-white text-text-primary transition-colors" />
              <textarea placeholder="내용을 입력하세요" value={writeContent} onChange={(e) => setWriteContent(e.target.value)} className="w-full px-4 py-3 text-[14px] border border-border rounded-[12px] outline-none focus:border-navy bg-white text-text-primary resize-none leading-relaxed transition-colors" rows={8} />
              <button onClick={handleWrite} disabled={writeLoading || !writeTitle.trim() || !writeContent.trim()} className="w-full h-11 bg-navy text-white text-[14px] font-semibold rounded-[12px] border-none cursor-pointer hover:bg-navy-light disabled:opacity-30 transition-all">{writeLoading ? "등록 중..." : "등록하기"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
