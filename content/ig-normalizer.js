/**
 * IgNormalizer — converts the raw JSON from Instagram's internal APIs into the
 * normalized InstaGhost schema (schema-03, validated by the Driver A spike).
 * No dependencies, no network requests. Designed to run in the
 * content-script (isolated world).
 */
const IgNormalizer = {
  MEDIA_TYPE: { 1: 'image', 2: 'video', 8: 'carousel' },

  /** profile: raw user (web_profile_info) -> schema */
  profile(handle, u) {
    if (!u) return { handle, error: 'profile not available' };
    return {
      handle,
      userId: u.id,
      fullName: u.full_name || null,
      biography: u.biography || null,
      followers: u.edge_followed_by?.count ?? null,
      following: u.edge_follow?.count ?? null,
      postsTotal: u.edge_owner_to_timeline_media?.count ?? null,
      isVerified: !!u.is_verified,
      isPrivate: !!u.is_private,
      isBusiness: u.is_business_account ?? null,
      category: u.category_name ?? u.category ?? null,
      externalUrl: u.external_url || null,
      profilePicUrl: u.profile_pic_url_hd || u.profile_pic_url || null,
    };
  },

  /** audio (reel): clips_metadata -> {title, artist, isOriginal, audioId} | null */
  _audio(it) {
    const cm = it.clips_metadata;
    if (!cm) return null;
    const mi = cm.music_info?.music_asset_info;
    const os = cm.original_sound_info;
    if (!mi && !os) return null;
    return {
      title: mi?.title || os?.original_audio_title || null,
      artist: mi?.display_artist || os?.ig_artist?.username || null,
      audioId: mi?.audio_id || os?.audio_asset_id || null,
      isOriginal: !!os,
    };
  },

  /** downloadable media: one entry per slide for carousels; picks the video if present, otherwise the largest image */
  _mediaItems(it) {
    const out = [];
    const pick = (m) => {
      if (!m) return;
      const video = m.video_versions?.[0]?.url;
      if (video) { out.push({ type: 'video', url: video }); return; }
      const img = m.image_versions2?.candidates?.[0]?.url;
      if (img) out.push({ type: 'image', url: img });
    };
    if (Array.isArray(it.carousel_media) && it.carousel_media.length) it.carousel_media.forEach(pick);
    else pick(it);
    return out;
  },

  /** post: raw feed item -> schema (without topComments, added separately) */
  post(it) {
    const text = it.caption?.text || '';
    return {
      id: it.pk || it.id,
      shortcode: it.code,
      permalink: it.code ? `https://www.instagram.com/p/${it.code}/` : null,
      date: new Date((it.taken_at || 0) * 1000).toISOString(),
      takenAt: it.taken_at ?? null,
      type: IgNormalizer.MEDIA_TYPE[it.media_type] || String(it.media_type),
      productType: it.product_type || null,
      isPinned: (it.timeline_pinned_user_ids || []).length > 0,
      caption: text,
      hashtags: (text.match(/#[\wÀ-ſ]+/gu) || []).map(h => h.slice(1)),
      mentions: (text.match(/@[\w.]+/g) || []).map(m => m.slice(1)),
      // like_count can be skewed/hidden on ad reels -> null
      likeCount: it.like_and_view_counts_disabled ? null : (it.like_count ?? null),
      commentCount: it.comment_count ?? null,
      playCount: it.play_count ?? it.ig_play_count ?? null,
      carouselCount: it.carousel_media_count ?? null,
      thumbnailUrl: it.image_versions2?.candidates?.[0]?.url || null,
      videoUrl: it.video_versions?.[0]?.url || null,
      media: IgNormalizer._mediaItems(it),
      dimensions: it.original_width ? { w: it.original_width, h: it.original_height } : null,
      durationSeconds: it.video_duration ?? null,
      location: it.location ? {
        name: it.location.name, lat: it.location.lat, lng: it.location.lng, city: it.location.city || null,
      } : null,
      audio: IgNormalizer._audio(it),
      coauthors: (it.coauthor_producers || []).map(c => c.username).filter(Boolean),
      taggedUsers: (it.usertags?.in || []).map(t => t.user?.username).filter(Boolean),
      isPaidPartnership: !!it.is_paid_partnership,
      topComments: [],
    };
  },

  /** comment: raw -> schema */
  comment(c) {
    return {
      user: c.user?.username || null,
      text: c.text || '',
      likes: c.comment_like_count ?? 0,
      at: new Date((c.created_at || 0) * 1000).toISOString(),
      replies: c.child_comment_count ?? 0,
    };
  },
};

if (typeof window !== 'undefined') window.IgNormalizer = IgNormalizer;
if (typeof module !== 'undefined') module.exports = IgNormalizer;
