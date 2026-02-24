import os
from PIL import Image
import glob

# --- Configuration ---
SOURCE_IMAGE_DIR = os.path.join('client', 'src', 'assets', 'source')
PWA_ICON_OUTPUT_DIR = os.path.join('client', 'public')
OPTIMIZED_ASSETS_DIR = os.path.join('client', 'src', 'assets')
LOGO_KEYWORDS = ['logo', 'icon']
BACKGROUND_KEYWORDS = ['background', 'backdrop']
LAYER_KEYWORDS = ['layer', 'overlay']


# --- Main Script Logic ---

def process_pwa_icons(source_path):
    """Creates PWA-standard .png icons in the /public folder."""
    print(f"⚙️  Processing PWA Icons from '{os.path.basename(source_path)}'...")
    icon_sizes = [192, 512]
    try:
        with Image.open(source_path) as img:
            img = img.convert('RGBA')
            for size in icon_sizes:
                resized_img = img.resize((size, size), Image.Resampling.LANCZOS)
                output_filename = f"logo{size}.png"
                output_path = os.path.join(PWA_ICON_OUTPUT_DIR, output_filename)
                resized_img.save(output_path, 'PNG')
                print(f"✅ Created PWA icon: '{output_path}'")
    except Exception as e:
        print(f"❌ Error processing PWA icons for '{source_path}': {e}")


def process_component_logo(source_path):
    """Creates an optimized logo in /src/assets for React components to import."""
    print(f"⚙️  Processing Component Logo from '{os.path.basename(source_path)}'...")
    max_width = 400
    try:
        with Image.open(source_path) as img:
            img = img.convert('RGBA')
            if img.width > max_width:
                aspect_ratio = img.height / img.width
                new_height = int(max_width * aspect_ratio)
                img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)
            output_filename = "logo.png"
            output_path = os.path.join(OPTIMIZED_ASSETS_DIR, output_filename)
            img.save(output_path, 'PNG')
            print(f"✅ Created Component logo: '{output_path}'")
    except Exception as e:
        print(f"❌ Error processing component logo for '{source_path}': {e}")


def process_background(source_path):
    """Optimizes background images and converts them to .webp format."""
    print(f"⚙️  Processing Background from '{os.path.basename(source_path)}'...")
    max_width = 1920
    try:
        with Image.open(source_path) as img:
            if img.mode in ('RGBA', 'LA'):
                img = img.convert('RGB')
            if img.width > max_width:
                aspect_ratio = img.height / img.width
                new_height = int(max_width * aspect_ratio)
                img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)
            output_filename = "background.webp"
            output_path = os.path.join(OPTIMIZED_ASSETS_DIR, output_filename)
            img.save(output_path, 'WEBP', quality=85)
            print(f"✅ Created optimized background: '{output_path}'")
    except Exception as e:
        print(f"❌ Error processing background '{source_path}': {e}")


def process_layer(source_path):
    """Optimizes layer images, enforces consistent naming, and saves as PNGs."""
    print(f"⚙️  Processing Layer from '{os.path.basename(source_path)}'...")
    max_width = 1920
    try:
        with Image.open(source_path) as img:
            img = img.convert('RGBA')
            if img.width > max_width:
                aspect_ratio = img.height / img.width
                new_height = int(max_width * aspect_ratio)
                img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)

            base_name = os.path.splitext(os.path.basename(source_path))[0]
            # --- THE FIX: Automatically replace underscores with hyphens --- #
            consistent_name = base_name.replace('_', '-')
            output_filename = f"{consistent_name}.png"

            output_path = os.path.join(OPTIMIZED_ASSETS_DIR, output_filename)
            img.save(output_path, 'PNG')
            print(f"✅ Created consistent layer: '{output_path}'")
    except Exception as e:
        print(f"❌ Error processing layer '{source_path}': {e}")


def main():
    """Finds and processes all images in the source directory."""
    print("--- Starting Automated Image Asset Processing ---")
    os.makedirs(PWA_ICON_OUTPUT_DIR, exist_ok=True)
    os.makedirs(OPTIMIZED_ASSETS_DIR, exist_ok=True)

    if not os.path.exists(SOURCE_IMAGE_DIR):
        print(f"❌ Error: Source directory not found at '{SOURCE_IMAGE_DIR}'")
        return

    image_paths = glob.glob(os.path.join(SOURCE_IMAGE_DIR, '*.[jp][pn]g')) + glob.glob(
        os.path.join(SOURCE_IMAGE_DIR, '*.jpeg'))

    if not image_paths:
        print("🤷 No images found. Add images to the 'source' folder.")
        return

    for path in image_paths:
        filename = os.path.basename(path).lower()
        if any(keyword in filename for keyword in LOGO_KEYWORDS):
            process_pwa_icons(path)
            process_component_logo(path)
        elif any(keyword in filename for keyword in BACKGROUND_KEYWORDS):
            process_background(path)
        elif any(keyword in filename for keyword in LAYER_KEYWORDS):
            process_layer(path)

    print("\n--- ✨ All tasks complete! ---")


if __name__ == "__main__":
    main()