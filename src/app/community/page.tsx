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

const CATEGORY_COLORS: Record<string, string> = {
  정유사정보: "bg-blue-100 text-blue-700",
  운영고민: "bg-orange-100 text-orange-700",
  장비추천: "bg-green-100 text-green-700",
  구인구직: "bg-purple-100 text-purple-700",
  자유: "bg-gray-100 text-gray-600",
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
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return new Date(dateStr).toLocaleDateString("ko-KR");
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

  // 글쓰기 모달
  const [showWrite, setShowWrite] = useState(false);
  const [writeCategory, setWriteCategory] = useState("자유");
  const [writeTitle, setWriteTitle] = useState("");
  const [writeContent, setWriteContent] = useState("");
  const [writeLoading, setWriteLoading] = useState(false);

  // 상세 보기
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [postDetail, setPostDetail] = useState<{
    post: Post;
    comments: Array<{
      id: string;
      content: string;
      created_at: string;
      author: { id: string; nickname: string } | null;
    }>;
    liked: boolean;
  } | null>(null);
  const [commentText, setCommentText] = useState("");

  const fetchPosts = useCallback(async () => {
    setLoading(true);

    const orderCol =
      sortBy === "popular" ? "likes_count" :
      sortBy === "comments" ? "comments_count" :
      "created_at";

    let query = supabaseAuth
      .from("posts")
      .select("id, author_id, category, title, content, likes_count, comments_count, created_at, author:users_profile!author_id(nickname)")
      .order(orderCol, { ascending: false })
      .limit(50);

    if (category !== "all") {
      query = query.eq("category", category);
    }

    if (searchQuery.trim()) {
      query = query.or(`title.ilike.%${searchQuery.trim()}%,content.ilike.%${searchQuery.trim()}%`);
    }

    const { data } = await query;
    setPosts((data as unknown as Post[]) || []);
    setLoading(false);
  }, [category, sortBy, searchQuery]);

  // 인기글 TOP 5 (좋아요 기준, 전체 카테고리)
  const fetchTopPosts = useCallback(async () => {
    const { data } = await supabaseAuth
      .from("posts")
      .select("id, author_id, category, title, content, likes_count, comments_count, created_at, author:users_profile!author_id(nickname)")
      .order("likes_count", { ascending: false })
      .limit(5);
    setTopPosts((data as unknown as Post[]) || []);
  }, []);

  const refreshAll = useCallback(() => {
    refreshAll();
    fetchTopPosts();
  }, [fetchPosts, fetchTopPosts]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const handleWrite = async () => {
    if (!user || !writeTitle.trim() || !writeContent.trim()) return;
    setWriteLoading(true);
    const { error } = await supabaseAuth.from("posts").insert({
      author_id: user.id,
      category: writeCategory,
      title: writeTitle.trim(),
      content: writeContent.trim(),
    });
    setWriteLoading(false);
    if (!error) {
      setShowWrite(false);
      setWriteTitle("");
      setWriteContent("");
      refreshAll();
    }
  };

  const openPost = async (post: Post) => {
    setSelectedPost(post);

    const { data: comments } = await supabaseAuth
      .from("comments")
      .select("id, content, created_at, author:users_profile!author_id(id, nickname)")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true });

    let liked = false;
    if (user) {
      const { data } = await supabaseAuth
        .from("post_likes")
        .select("post_id")
        .eq("post_id", post.id)
        .eq("user_id", user.id)
        .maybeSingle();
      liked = !!data;
    }

    setPostDetail({
      post,
      comments: (comments as unknown as typeof postDetail extends null ? never : NonNullable<typeof postDetail>["comments"]) || [],
      liked,
    });
  };

  const toggleLike = async () => {
    if (!user || !postDetail) return;
    if (postDetail.liked) {
      await supabaseAuth
        .from("post_likes")
        .delete()
        .eq("post_id", postDetail.post.id)
        .eq("user_id", user.id);
    } else {
      await supabaseAuth
        .from("post_likes")
        .insert({ post_id: postDetail.post.id, user_id: user.id });
    }
    // 리로드
    await openPost(postDetail.post);
    refreshAll();
  };

  const addComment = async () => {
    if (!user || !postDetail || !commentText.trim()) return;
    await supabaseAuth.from("comments").insert({
      post_id: postDetail.post.id,
      author_id: user.id,
      content: commentText.trim(),
    });
    setCommentText("");
    await openPost(postDetail.post);
    refreshAll();
  };

  const deletePost = async (postId: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await supabaseAuth.from("posts").delete().eq("id", postId);
    setSelectedPost(null);
    setPostDetail(null);
    refreshAll();
  };

  const deleteComment = async (commentId: string) => {
    if (!confirm("댓글을 삭제하시겠습니까?")) return;
    await supabaseAuth.from("comments").delete().eq("id", commentId);
    if (postDetail) await openPost(postDetail.post);
    refreshAll();
  };

  // ── 비로그인 안내 ──
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* 헤더 */}
        <header className="h-[56px] bg-navy flex items-center justify-between px-4 md:px-6 shrink-0">
          <div className="flex items-center gap-2.5">
            <Link href="/" className="flex items-center gap-2.5 no-underline">
              <div className="w-8 h-8 bg-accent-orange rounded-lg flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 22V8l5-6h4l-1 7h7a2 2 0 0 1 2 2.5L18 22H3z" />
                </svg>
              </div>
              <span className="text-white text-[17px] font-bold tracking-tight">주유소맵</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1 ml-4">
              <Link href="/" className="px-3 py-1.5 text-[12px] text-gray-300 hover:text-white hover:bg-white/10 rounded-md transition-colors no-underline">지도</Link>
              <Link href="/community" className="px-3 py-1.5 text-[12px] text-white bg-white/15 rounded-md no-underline">커뮤니티</Link>
            </nav>
          </div>
          <button onClick={() => setShowAuth(true)} className="px-3 py-1.5 text-[12px] font-semibold text-navy bg-accent-orange hover:brightness-110 rounded-md border-none cursor-pointer transition-all">
            로그인
          </button>
        </header>

        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-navy/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1a2332" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h2 className="text-[20px] font-bold text-gray-900 mb-2">커뮤니티</h2>
            <p className="text-[14px] text-gray-500 mb-6 leading-relaxed">
              주유소 사장님들의 정보 공유 공간입니다.<br />
              로그인 후 이용할 수 있습니다.
            </p>
            <button
              onClick={() => setShowAuth(true)}
              className="px-6 py-3 bg-navy text-white text-[14px] font-semibold rounded-xl border-none cursor-pointer hover:opacity-90 transition-opacity"
            >
              로그인하기
            </button>
          </div>
        </div>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </div>
    );
  }

  // ── 게시글 상세 ──
  if (selectedPost && postDetail) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <CommunityHeader user={user} profile={profile} signOut={signOut} />

        <div className="max-w-2xl mx-auto w-full p-4 flex-1">
          {/* 뒤로가기 */}
          <button
            onClick={() => { setSelectedPost(null); setPostDetail(null); }}
            className="flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-700 bg-transparent border-none cursor-pointer mb-4 p-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            목록으로
          </button>

          {/* 게시글 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5">
              <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-md mb-2 ${CATEGORY_COLORS[postDetail.post.category] || "bg-gray-100 text-gray-600"}`}>
                {postDetail.post.category}
              </span>
              <h1 className="text-[18px] font-bold text-gray-900 m-0 mb-2">{postDetail.post.title}</h1>
              <div className="flex items-center gap-2 text-[12px] text-gray-400 mb-4">
                <span className="font-medium text-gray-600">
                  {(postDetail.post.author as { nickname: string } | null)?.nickname || "알 수 없음"}
                </span>
                <span>·</span>
                <span>{timeAgo(postDetail.post.created_at)}</span>
              </div>
              <p className="text-[14px] text-gray-700 leading-relaxed whitespace-pre-wrap m-0">
                {postDetail.post.content}
              </p>
            </div>

            {/* 좋아요 + 삭제 */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3">
              <button
                onClick={toggleLike}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-medium border-none cursor-pointer transition-all ${
                  postDetail.liked
                    ? "bg-red-50 text-red-500"
                    : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={postDetail.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                {postDetail.post.likes_count}
              </button>
              {user.id === postDetail.post.author_id && (
                <button
                  onClick={() => deletePost(postDetail.post.id)}
                  className="ml-auto text-[11px] text-gray-400 hover:text-red-500 bg-transparent border-none cursor-pointer"
                >
                  삭제
                </button>
              )}
            </div>
          </div>

          {/* 댓글 */}
          <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-[14px] font-bold text-gray-900 m-0">
                댓글 {postDetail.comments.length}
              </h3>
            </div>

            {postDetail.comments.map((c) => (
              <div key={c.id} className="px-5 py-3 border-b border-gray-50">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-gray-700">
                      {c.author?.nickname || "알 수 없음"}
                    </span>
                    <span className="text-[11px] text-gray-400">{timeAgo(c.created_at)}</span>
                  </div>
                  {user.id === c.author?.id && (
                    <button
                      onClick={() => deleteComment(c.id)}
                      className="text-[10px] text-gray-400 hover:text-red-500 bg-transparent border-none cursor-pointer"
                    >
                      삭제
                    </button>
                  )}
                </div>
                <p className="text-[13px] text-gray-600 m-0">{c.content}</p>
              </div>
            ))}

            {/* 댓글 입력 */}
            <div className="p-4 flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="댓글을 입력하세요"
                className="flex-1 px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-navy bg-white text-gray-900"
                onKeyDown={(e) => e.key === "Enter" && addComment()}
              />
              <button
                onClick={addComment}
                disabled={!commentText.trim()}
                className="px-4 py-2 bg-navy text-white text-[12px] font-semibold rounded-lg border-none cursor-pointer hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                등록
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 게시글 목록 ──
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <CommunityHeader user={user} profile={profile} signOut={signOut} />

      <div className="max-w-2xl mx-auto w-full p-4 flex-1">
        {/* 검색바 */}
        <div className="relative mb-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="게시글 검색 (제목, 내용)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2.5 text-[13px] bg-white border border-gray-200 rounded-xl outline-none focus:border-navy transition-colors text-gray-900"
          />
        </div>

        {/* 카테고리 탭 + 정렬 */}
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide flex-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg border-none cursor-pointer whitespace-nowrap transition-all ${
                  category === c.key
                    ? "bg-navy text-white"
                    : "bg-white text-gray-500 hover:bg-gray-100 shadow-sm"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "latest" | "popular" | "comments")}
            className="px-2 py-1.5 text-[11px] bg-white border border-gray-200 rounded-lg outline-none text-gray-600 cursor-pointer shrink-0"
          >
            <option value="latest">최신순</option>
            <option value="popular">인기순</option>
            <option value="comments">댓글순</option>
          </select>
        </div>

        {/* 인기글 TOP 5 */}
        {topPosts.length > 0 && category === "all" && !searchQuery && sortBy === "latest" && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-4 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" strokeWidth="1">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              <span className="text-[12px] font-bold text-accent-orange">인기글 TOP 5</span>
            </div>
            {topPosts.map((post, i) => (
              <div
                key={post.id}
                onClick={() => openPost(post)}
                className="px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
              >
                <span className={`text-[13px] font-bold w-5 text-center shrink-0 ${i === 0 ? "text-accent-orange" : "text-gray-300"}`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-gray-800 truncate m-0">{post.title}</p>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                  {post.likes_count}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 글쓰기 버튼 */}
        <button
          onClick={() => setShowWrite(true)}
          className="w-full mb-4 py-3 bg-white text-gray-400 text-[13px] rounded-xl border border-dashed border-gray-300 cursor-pointer hover:border-navy hover:text-navy transition-colors flex items-center justify-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
          새 글 작성하기
        </button>

        {/* 게시글 목록 */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-navy rounded-full animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[14px] text-gray-400">아직 게시글이 없습니다.</p>
            <p className="text-[12px] text-gray-300 mt-1">첫 번째 글을 작성해보세요!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {posts.map((post) => (
              <div
                key={post.id}
                onClick={() => openPost(post)}
                className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 cursor-pointer hover:border-gray-200 hover:shadow transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded mb-1.5 ${CATEGORY_COLORS[post.category] || "bg-gray-100 text-gray-600"}`}>
                      {post.category}
                    </span>
                    <h3 className="text-[14px] font-semibold text-gray-900 m-0 mb-1 truncate">
                      {post.title}
                    </h3>
                    <p className="text-[12px] text-gray-500 m-0 line-clamp-1">
                      {post.content}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                  <span className="font-medium text-gray-500">
                    {(post.author as { nickname: string } | null)?.nickname || "알 수 없음"}
                  </span>
                  <span>{timeAgo(post.created_at)}</span>
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
          <div className="bg-white rounded-2xl w-full max-w-[500px] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-navy px-5 py-4 flex items-center justify-between">
              <h2 className="text-white text-[16px] font-bold m-0">글쓰기</h2>
              <button onClick={() => setShowWrite(false)} className="text-gray-400 hover:text-white bg-transparent border-none cursor-pointer">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[12px] font-semibold text-gray-600 mb-1 block">카테고리</label>
                <div className="flex gap-1.5 flex-wrap">
                  {CATEGORIES.filter((c) => c.key !== "all").map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setWriteCategory(c.key)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md border-none cursor-pointer transition-all ${
                        writeCategory === c.key
                          ? "bg-navy text-white"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="text"
                placeholder="제목을 입력하세요"
                value={writeTitle}
                onChange={(e) => setWriteTitle(e.target.value)}
                className="w-full px-3 py-2.5 text-[14px] font-semibold border border-gray-200 rounded-lg outline-none focus:border-navy bg-white text-gray-900"
              />
              <textarea
                placeholder="내용을 입력하세요"
                value={writeContent}
                onChange={(e) => setWriteContent(e.target.value)}
                className="w-full px-3 py-2.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-navy bg-white text-gray-900 resize-none"
                rows={8}
              />
              <button
                onClick={handleWrite}
                disabled={writeLoading || !writeTitle.trim() || !writeContent.trim()}
                className="w-full py-2.5 bg-navy text-white text-[13px] font-semibold rounded-lg border-none cursor-pointer hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {writeLoading ? "등록 중..." : "등록하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CommunityHeader({
  user,
  profile,
  signOut,
}: {
  user: { id: string };
  profile: { nickname: string } | null;
  signOut: () => void;
}) {
  return (
    <header className="h-[56px] bg-navy flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-2.5">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <div className="w-8 h-8 bg-accent-orange rounded-lg flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 22V8l5-6h4l-1 7h7a2 2 0 0 1 2 2.5L18 22H3z" />
            </svg>
          </div>
          <span className="text-white text-[17px] font-bold tracking-tight">주유소맵</span>
        </Link>
        <nav className="hidden md:flex items-center gap-1 ml-4">
          <Link href="/" className="px-3 py-1.5 text-[12px] text-gray-300 hover:text-white hover:bg-white/10 rounded-md transition-colors no-underline">지도</Link>
          <Link href="/community" className="px-3 py-1.5 text-[12px] text-white bg-white/15 rounded-md no-underline">커뮤니티</Link>
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-gray-300 hidden md:inline">{profile?.nickname || "사용자"}</span>
        <button onClick={signOut} className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-white bg-white/10 hover:bg-white/20 rounded-md border-none cursor-pointer transition-colors">
          로그아웃
        </button>
      </div>
    </header>
  );
}
