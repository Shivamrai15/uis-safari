import type { Request, Response } from "express";
import { differenceInDays } from "date-fns";
import { AddBulkSongsSchema, PlaylistSchema } from "../schemas/playlist.schema.js";
import { db } from "../lib/db.js";
import type {
  Album,
  PlaylistSong,
  Song,
} from "../../generated/prisma/index.js";

const BATCH = 10;

export async function createPlaylist(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const validatedData = await PlaylistSchema.safeParseAsync(req.body);
    if (!validatedData.success) {
      return res.status(400).json({
        status: false,
        message: "Invalid request data",
        data: validatedData.error,
      });
    }

    const playlist =await db.playList.create({
      data: {
        userId: user.userId,
        name: validatedData.data.name,
        description: validatedData.data.description ?? null,
        private: validatedData.data.private,
      },
    });

    return res.status(201).json({
      status: true,
      message: "Playlist created successfully",
      data: playlist,
    });
  } catch (error) {
    console.error("CREATE PLAYLIST API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export async function getUserPlaylists(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const playlists = await db.playList.findMany({
      where: {
        userId: user.userId,
        isArchived: false,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        _count: {
          select: {
            songs: true,
          },
        },
      },
    });

    return res.status(200).json({
      status: true,
      message: "Success",
      data: playlists,
    });
  } catch (error) {
    console.error("GET ALL PLAYLIST API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export async function getPlaylistSongs(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const playlistId = req.params.id;

    if (!playlistId) {
      return res.status(400).json({
        status: false,
        message: "Bad Request",
        data: {},
      });
    }

    const playlist = await db.playList.findUnique({
      where: {
        id: playlistId,
      },
      select: {
        id: true,
        userId: true,
        private: true,
        isArchived: true,
      },
    });

    if (!playlist) {
      return res.status(404).json({
        status: false,
        message: "Playlist not found",
        data: {},
      });
    }

    if (
      (playlist.private && playlist.userId !== user.userId) ||
      playlist.isArchived
    ) {
      return res.status(403).json({
        status: false,
        message: "Unauthorized Access",
        data: {},
      });
    }

    let playlistSongs: (PlaylistSong & {
      song: Song & {
        album: Album;
        artists: { id: string; name: string; image: string }[];
      };
    })[] = [];

    const { cursor } = req.query;

    if (cursor) {
      playlistSongs = await db.playlistSong.findMany({
        where: {
          playlistId: playlist.id,
        },
        take: BATCH,
        skip: 1,
        cursor: {
          id: cursor as string,
        },
        include: {
          song: {
            include: {
              album: true,
              artists: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    } else {
      playlistSongs = await db.playlistSong.findMany({
        where: {
          playlistId: playlist.id,
        },
        take: BATCH,
        include: {
          song: {
            include: {
              album: true,
              artists: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }

    let nextCursor = null;

    if (playlistSongs.length === BATCH) {
      nextCursor = playlistSongs[BATCH - 1]?.id;
    }
    return res.json({
      items: playlistSongs,
      nextCursor,
    });
  } catch (error) {
    console.error("GET PLAYLIST SONGS API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export async function removePlaylistSong(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const playlistId = req.params.id;
    const songId = req.params.songId;
    if (!playlistId || !songId) {
      return res.status(400).json({
        status: false,
        message: "Bad Request",
        data: {},
      });
    }

    const firstPlaylistSong = await db.playlistSong.findMany({
      where: {
        playlistId: playlistId,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 2,
    });

    await db.playlistSong.delete({
      where: {
        songId_playlistId: {
          songId: songId,
          playlistId: playlistId,
        },
      },
    });

    if (firstPlaylistSong[0]?.songId === songId) {
      if (firstPlaylistSong.length === 2) {
        const song = await db.song.findUnique({
          where: {
            id: firstPlaylistSong[1]?.songId ?? "",
          },
          select: {
            image: true,
            album: {
              select: {
                color: true,
              },
            },
          },
        });

        if (song) {
          await db.playList.update({
            where: {
              id: playlistId,
            },
            data: {
              image: song.image,
              color: song.album.color,
            },
          });
        }
      } else {
        await db.playList.update({
          where: {
            id: playlistId,
          },
          data: {
            image: null,
            color: null,
          },
        });
      }
    }

    return res.json({
      success: true,
      message: "Song removed from playlist successfully",
      data: {},
    });
  } catch (error) {
    console.error("DELETE PLAYLIST SONG API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export async function addPlaylistSong(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const playlistId = req.params.id;
    const songId = req.params.songId;

    if (!playlistId || !songId) {
      return res.status(400).json({
        status: false,
        message: "Bad Request",
        data: {},
      });
    }

    const playlist = await db.playList.findUnique({
      where: {
        id: playlistId,
        userId: user.userId,
      },
      select: {
        _count: {
          select: {
            songs: true,
          },
        },
        id: true,
        userId: true,
      },
    });

    if (!playlist) {
      return res.status(404).json({
        status: false,
        message: "Playlist not found",
        data: {},
      });
    }

    const song = await db.song.findUnique({
      where: {
        id: songId,
      },
      select: {
        id: true,
        image: true,
        album: {
          select: {
            color: true,
          },
        },
      },
    });

    if (!song) {
      return res.status(404).json({
        status: false,
        message: "Song not found",
        data: {},
      });
    }

    if (playlist._count.songs === 0) {
      await db.playList.update({
        where: {
          id: playlist.id,
        },
        data: {
          image: song.image,
          color: song.album.color,
        },
      });
    }

    await db.playlistSong.create({
      data: {
        playlistId: playlistId,
        songId,
      },
    });

    return res.status(201).json({
      status: true,
      message: "Song added to playlist successfully",
      data: {},
    });
  } catch (error) {
    console.error("PLAYLIST SONG POST API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export async function getUserPlaylist(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const playlistId = req.params.id;

    if (!playlistId) {
      return res.status(400).json({
        status: false,
        message: "Bad Request",
        data: {},
      });
    }

    const playlist = await db.playList.findUnique({
      where: {
        id: playlistId,
        userId: user.userId,
        isArchived: false,
      },
      include: {
        _count: {
          select: {
            songs: true,
          },
        },
      },
    });

    if (!playlist) {
      return res.status(404).json({
        status: false,
        message: "Playlist not found",
        data: {},
      });
    }

    return res.status(200).json({
      status: true,
      message: "Success",
      data: playlist,
    });
  } catch (error) {
    console.error("GET PLAYLIST API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export async function restorePlaylist(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const playlistId = req.params.id;

    if (!playlistId) {
      return res.status(400).json({
        status: false,
        message: "Bad Request",
        data: {},
      });
    }

    const playlist = await db.playList.findUnique({
      where: {
        id: playlistId,
        userId: user.userId,
        isArchived: true,
      },
    });

    if (!playlist || !playlist.archivedAt) {
      return res.status(404).json({
        status: false,
        message: "Playlist not found",
        data: {},
      });
    }

    if (differenceInDays(playlist.archivedAt, new Date()) > 90) {
      await db.playList.delete({
        where: {
          id: playlist.id,
        },
      });

      return res.status(410).json({
        status: false,
        message: "Cannot restore this playlist",
        data: {},
      });
    }

    await db.playList.update({
      where: {
        id: playlist.id,
      },
      data: {
        isArchived: false,
        archivedAt: null,
      },
    });

    return res.status(200).json({
      status: true,
      message: "Playlist restored successfully",
      data: {},
    });
  } catch (error) {
    console.error("RESTORE PLAYLIST API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export async function updateUserPlaylist(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const playlistId = req.params.id;

    if (!playlistId) {
      return res.status(400).json({
        status: false,
        message: "Bad Request",
        data: {},
      });
    }

    const validatedData = await PlaylistSchema.safeParseAsync(req.body);
    if (!validatedData.success) {
      return res.status(400).json({
        status: false,
        message: "Invalid request data",
        data: {},
      });
    }

    const playlist = await db.playList.findUnique({
      where: {
        id: playlistId,
        userId: user.userId,
        isArchived: false,
      },
    });

    if (!playlist) {
      return res.status(404).json({
        status: false,
        message: "Playlist not found",
        data: {},
      });
    }

    await db.playList.update({
      where: {
        id: playlistId,
      },
      data: {
        name: validatedData.data.name,
        description: validatedData.data.description ?? null,
        private: validatedData.data.private,
      },
    });

    return res.status(200).json({
      status: true,
      message: "Playlist updated successfully",
      data: {},
    });
  } catch (error) {
    console.error("UPDATE PLAYLIST API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}


export async function deleteUserPlaylist(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const playlistId = req.params.id;

    if (!playlistId) {
      return res.status(400).json({
        status: false,
        message: "Bad Request",
        data: {},
      });
    }

    const playlist = await db.playList.findUnique({
      where: {
        id: playlistId,
        userId: user.userId,
        isArchived: false,
      },
    });

    if (!playlist) {
      return res.status(404).json({
        status: false,
        message: "Playlist not found",
        data: {},
      });
    }

    await db.playList.update({
      where: {
        id: playlistId,
      },
      data: {
        isArchived: true,
        archivedAt: new Date(),
      },
    });

    return res.status(200).json({
      status: true,
      message: "Playlist deleted successfully",
      data: {},
    });
  } catch (error) {
    console.error("DELETE PLAYLIST API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export async function getPlaylistExistingSongs(req: Request, res: Response) {
  try {

    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const playlistId = req.params.id;

    if (!playlistId) {
      return res.status(400).json({
        status: false,
        message: "Bad Request",
        data: {},
      });
    }

    const playlist = await db.playList.findUnique({
      where: {
        id: playlistId,
        userId: user.userId,
        isArchived: false,
      },
    });

    if (!playlist) {
      return res.status(404).json({
        status: false,
        message: "Playlist not found",
        data: {},
      });
    }

    const playlistSongs = await db.playlistSong.findMany({
      where :{
        playlistId: playlist.id,
      },
      select : {
        songId: true,
      }
    });

    const songIds = playlistSongs.map((ps) => ps.songId);
    return res.status(200).json({
      status: true,
      message: "Success",
      data: songIds,
    });
    
  } catch (error) {
    console.error("PLAYLIST EXISTING SONGS API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export async function addPlaylistSongsBulk(req: Request, res: Response) {
  try {

    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const validatedData = await AddBulkSongsSchema.safeParseAsync(req.body);
    if (!validatedData.success) {
      return res.status(400).json({
        status: false,
        message: "Invalid request data",
        data: validatedData.error,
      });
    }

    const playlist = await db.playList.findUnique({
      where: {
        id: validatedData.data.playlistId,
        userId: user.userId,
        isArchived: false,
      },
      include : {
        _count : {
          select : {
            songs : true
          }
        }
      }
    });
    if (!playlist) {
      return res.status(404).json({
        status: false,
        message: "Playlist not found",
        data: {},
      });
    }

    const song = await db.song.findUnique({
      where: {
        id: validatedData.data.songIds[0] as string,
      },
      select : {
        id : true,
        image : true,
        album : {
          select : {
            color : true
          }
        }
      }
    });

    if (!song) {
      return res.status(404).json({
        status: false,
        message: "Song not found",
        data: {},
      });
    }

    if (playlist._count.songs === 0) {
      await db.playList.update({
        where: {
          id: playlist.id,
        },
        data: {
          color : song.album.color,
          image : song.image,
        },
      });
    }
    
    await db.playlistSong.createMany({
      data : validatedData.data.songIds.map((songId) => ({
        playlistId: playlist.id,
        songId,
      })),
    });

    return res.status(201).json({
      status: true,
      message: "Songs added to playlist successfully",
      data: {},
    });
    
  } catch (error) {
    console.error("ADD PLAYLIST SONGS BULK API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export const getAllPlaylistSongs = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }
    const playlistId = req.params.id;
    if (!playlistId) {
      return res.status(400).json({
        status: false,

        message: "Bad Request",
        data: {},
      });
    }

    const playlist = await db.playList.findUnique({
      where: {
        id: playlistId,
        userId: user.userId,
        isArchived: false,
      },
    });
    if (!playlist) {

      return res.status(404).json({
        status: false,
        message: "Playlist not found",
        data: {},
      });
    } 
    const playlistSongs = await db.playlistSong.findMany({
      where: {
        playlistId: playlist.id,
      },
      include: {
        song: {
          include: {
            album: true,
            artists: {  

              select: {
                id: true,
                name: true,  
                image: true,
              },
            },
          },
        },
      },
      orderBy: {  
        createdAt: "desc",
      },
    });

    const songs = playlistSongs.map((ps) => ps.song);
    return res.status(200).json({
      status: true,
      message: "Success",
      data: songs,
    });
  } catch (error) {
    console.error("GET ALL PLAYLIST SONGS API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export const getArchivedPlaylists = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const archivedPlaylists = await db.playList.findMany({
      where: {
        userId: user.userId,
        isArchived: true, 
      },
      orderBy: {
        archivedAt: "desc",
      },
      include: {
        _count: {
          select: {
            songs: true,
          },
        },
      },
    });
    return res.status(200).json({
      status: true,
      message: "Success",
      data: archivedPlaylists,
    });
  }
  catch (error) {
    console.error("GET ARCHIVED PLAYLISTS API ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}
