import os
from moviepy.editor import ImageClip, AudioFileClip

# --- CONFIGURATION ---
# The name of the folder where your podcast assets are.
PODCAST_DIR = "podcast"


def create_podcast_video():
    """
    Finds an image and an audio file in the PODCAST_DIR,
    combines them into a high-quality MP4 video, and saves it
    in the same directory.
    """
    # 1. Validate that the podcast directory exists
    if not os.path.isdir(PODCAST_DIR):
        print(f"Error: Directory '{PODCAST_DIR}' not found.")
        print("Please create it and place your image and audio files inside.")
        return

    print(f"Searching for files in '{PODCAST_DIR}'...")

    # 2. Find the image and audio files
    image_file = None
    audio_file = None

    valid_image_exts = ['.png', '.jpg', '.jpeg']
    valid_audio_exts = ['.m4a', '.mp3', '.wav']

    for filename in os.listdir(PODCAST_DIR):
        # Use lower() to make the check case-insensitive
        file_ext = os.path.splitext(filename)[1].lower()

        if file_ext in valid_image_exts:
            if image_file is None:  # Found the first image
                image_file = filename
                print(f"  > Found image: {image_file}")
            else:
                print(f"  > Warning: Multiple images found. Using the first one: {image_file}")

        if file_ext in valid_audio_exts:
            if audio_file is None:  # Found the first audio file
                audio_file = filename
                print(f"  > Found audio: {audio_file}")
            else:
                print(f"  > Warning: Multiple audio files found. Using the first one: {audio_file}")

    # 3. Check if we found both files
    if not image_file or not audio_file:
        print("\nError: Could not find both an image and an audio file in the directory.")
        if not image_file: print("  - Missing image file (.png or .jpg)")
        if not audio_file: print("  - Missing audio file (.m4a, .mp3, etc.)")
        return

    # 4. Define full paths for input and output
    image_path = os.path.join(PODCAST_DIR, image_file)
    audio_path = os.path.join(PODCAST_DIR, audio_file)

    # Create the output filename based on the audio file's name
    output_filename = os.path.splitext(audio_file)[0] + '.mp4'
    output_path = os.path.join(PODCAST_DIR, output_filename)

    print(f"\nProcessing files:\n  Image: {image_path}\n  Audio: {audio_path}")
    print(f"Output will be: {output_path}\n")

    # 5. Create the video using MoviePy
    audio_clip = None
    video_clip = None
    try:
        audio_clip = AudioFileClip(audio_path)
        video_clip = ImageClip(image_path).set_duration(audio_clip.duration)

        # Combine the image clip with the audio clip
        final_clip = video_clip.set_audio(audio_clip)

        # Write the video file with high-quality settings
        # preset='slow' -> Better compression (higher quality for the file size)
        # ffmpeg_params=["-crf", "18"] -> Constant Rate Factor. 18 is considered
        # visually lossless or very close to it for H.264 video.
        final_clip.write_videofile(
            output_path,
            codec='libx264',
            audio_codec='aac',
            preset='slow',
            ffmpeg_params=["-crf", "18"]
        )

        print(f"\nSuccess! Video saved to {output_path}")

    except Exception as e:
        print(f"\nAn error occurred during video creation: {e}")
    finally:
        # Clean up the clips to release memory
        if audio_clip:
            audio_clip.close()
        if video_clip:
            video_clip.close()


if __name__ == '__main__':
    create_podcast_video()
