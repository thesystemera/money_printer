import React from 'react';
import ReactPlayer from 'react-player';
import { Box } from '@chakra-ui/react';

const SplashVideo = ({ isPlaying, isMuted }) => {
  const YOUTUBE_URL = 'https://www.youtube.com/watch?v=8d_LCAk6hJk';

  return (
    <Box
      position="absolute"
      top="0"
      left="0"
      width="100%"
      height="100%"
      overflow="hidden"
      zIndex="0"
    >
      <ReactPlayer
        url={YOUTUBE_URL}
        playing={isPlaying}
        muted={isMuted}
        loop={true}
        volume={0.5}
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          minWidth: '100%',
          minHeight: '100%',
          width: 'auto',
          height: 'auto',
        }}
        config={{
          youtube: {
            playerVars: {
              controls: 0,
              showinfo: 0,
              modestbranding: 1,
              autoplay: 1,
            }
          }
        }}
      />
    </Box>
  );
};

export default SplashVideo;