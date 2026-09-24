import { Router } from "express";
import {
  addPlaylistSong,
  createPlaylist,
  deleteUserPlaylist,
  getPlaylistSongs,
  getUserPlaylist,
  getUserPlaylists,
  removePlaylistSong,
  restorePlaylist,
  updateUserPlaylist,
  addPlaylistSongsBulk,
  getPlaylistExistingSongs,
  getAllPlaylistSongs,
  getArchivedPlaylists
} from "../controllers/playlist.controller.js";
import {
  acceptMember,
  createShareLink,
  declineMember,
  getPlaylistActivity,
  getPlaylistMembers,
  inviteMember,
  previewShareLink,
  removeMember,
  requestToJoin,
  updateMemberRole,
} from "../controllers/playlist-member.controller.js";

export const playlistRouter = Router();

playlistRouter.post("/", createPlaylist);
playlistRouter.get("/", getUserPlaylists);
playlistRouter.post("/songs", addPlaylistSongsBulk);
playlistRouter.get("/archived", getArchivedPlaylists);
playlistRouter.get("/join/:token", previewShareLink);
playlistRouter.get("/:id/songs", getPlaylistSongs);
playlistRouter.get("/:id/all-songs", getAllPlaylistSongs);
playlistRouter.get("/:id/existing-songs", getPlaylistExistingSongs);
playlistRouter.get("/:id/members", getPlaylistMembers);
playlistRouter.post("/:id/members/invite", inviteMember);
playlistRouter.post("/:id/members/request", requestToJoin);
playlistRouter.post("/:id/members/:memberId/accept", acceptMember);
playlistRouter.post("/:id/members/:memberId/decline", declineMember);
playlistRouter.patch("/:id/members/:memberId", updateMemberRole);
playlistRouter.delete("/:id/members/:memberId", removeMember);
playlistRouter.post("/:id/share", createShareLink);
playlistRouter.get("/:id/activity", getPlaylistActivity);
playlistRouter.patch("/:id/restore", restorePlaylist);
playlistRouter.delete("/:id/songs/:songId", removePlaylistSong);
playlistRouter.post("/:id/songs/:songId", addPlaylistSong);
playlistRouter.get("/:id", getUserPlaylist);
playlistRouter.patch("/:id", updateUserPlaylist);
playlistRouter.delete("/:id", deleteUserPlaylist);
