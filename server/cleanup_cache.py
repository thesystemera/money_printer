import os
import time
import json
from datetime import datetime
import sys


class CacheCleaner:
    def __init__(self, cache_dir='cache', dry_run=True):
        self.cache_dir = cache_dir
        self.dry_run = dry_run
        self.DEFAULT_EXPIRY = {
            'stocks': 30 * 24 * 60 * 60,
            'stocks_historical': 6 * 30 * 24 * 60 * 60,
            'earnings': 24 * 60 * 60,
            'response': 60 * 60,
            'portfolio': 72 * 60 * 60,
            'options': 6 * 30 * 24 * 60 * 60,
            'generic': 7 * 24 * 60 * 60,
            'articles': 90 * 24 * 60 * 60,
            'relevance': 90 * 24 * 60 * 60,
            'analysis': 90 * 24 * 60 * 60,
            'companies': 90 * 24 * 60 * 60,
            'recommendations': 180 * 24 * 60 * 60,
            'recommendation_images': 180 * 24 * 60 * 60,
            'prediction_accuracy': 8 * 60 * 60,
        }
        self.stats = {
            'total_files': 0,
            'deleted_files': 0,
            'kept_files': 0,
            'space_freed': 0,
            'errors': 0,
            'by_type': {}
        }

    def get_file_age_seconds(self, filepath):
        file_stat = os.stat(filepath)
        file_mtime = file_stat.st_mtime
        current_time = time.time()
        return current_time - file_mtime

    def format_age(self, seconds):
        days = seconds / (24 * 60 * 60)
        if days >= 1:
            return f"{days:.1f} days"
        hours = seconds / (60 * 60)
        if hours >= 1:
            return f"{hours:.1f} hours"
        return f"{seconds:.0f} seconds"

    def clean_directory(self, subdir, ttl_seconds):
        dir_path = os.path.join(self.cache_dir, subdir)
        if not os.path.exists(dir_path):
            return

        print(f"\n{'=' * 60}")
        print(f"Cleaning {subdir} (TTL: {self.format_age(ttl_seconds)})")
        print(f"{'=' * 60}")

        deleted_count = 0
        kept_count = 0
        space_freed = 0

        try:
            files = [f for f in os.listdir(dir_path) if f.endswith('.json')]
            total_files_in_dir = len(files)
        except FileNotFoundError:
            return

        for i, filename in enumerate(files):
            filepath = os.path.join(dir_path, filename)
            try:
                file_size = os.path.getsize(filepath)
                age_seconds = self.get_file_age_seconds(filepath)

                if age_seconds > ttl_seconds:
                    if not self.dry_run:
                        os.remove(filepath)
                    deleted_count += 1
                    space_freed += file_size
                else:
                    kept_count += 1

                status_msg = f"  Processed: {i + 1}/{total_files_in_dir} | Kept: {kept_count} | To Delete: {deleted_count}"
                print(status_msg, end='\r')
                sys.stdout.flush()

                self.stats['total_files'] += 1

            except Exception as e:
                print(f"  ERROR processing {filename}: {str(e)}")
                self.stats['errors'] += 1

        print()

        self.stats['deleted_files'] += deleted_count
        self.stats['kept_files'] += kept_count
        self.stats['space_freed'] += space_freed
        self.stats['by_type'][subdir] = {
            'deleted': deleted_count,
            'kept': kept_count,
            'space_freed': space_freed
        }

        print(f"\nSummary for {subdir}:")
        action_word = "Would delete" if self.dry_run else "Deleted"
        print(f"  {action_word}: {deleted_count} files ({space_freed / (1024 * 1024):.2f} MB)")
        print(f"  Kept: {kept_count} files")

    def clean_special_directories(self):
        options_dir = os.path.join(self.cache_dir, 'options')
        if os.path.exists(options_dir):
            print(f"\n{'=' * 60}")
            print(f"Cleaning options (special handling for tier1/tier2)")
            print(f"{'=' * 60}")

            deleted_count = 0
            kept_count = 0
            space_freed = 0

            files = [f for f in os.listdir(options_dir) if f.endswith('.json')]

            for filename in files:
                filepath = os.path.join(options_dir, filename)
                try:
                    file_size = os.path.getsize(filepath)
                    age_seconds = self.get_file_age_seconds(filepath)

                    with open(filepath, 'r') as f:
                        data = json.load(f)
                    date_key = data.get('date_key', '')

                    if "tier1" in date_key:
                        ttl_seconds = 60 * 60
                        tier = "tier1 (1 hour)"
                    else:
                        ttl_seconds = 6 * 30 * 24 * 60 * 60
                        tier = "tier2 (6 months)"

                    if age_seconds > ttl_seconds:
                        age_str = self.format_age(age_seconds)

                        if self.dry_run:
                            print(f"  [DRY RUN] Would delete: {filename[:50]}... ({tier}, age: {age_str})")
                        else:
                            os.remove(filepath)
                            print(f"  DELETED: {filename[:50]}... ({tier}, age: {age_str})")

                        deleted_count += 1
                        space_freed += file_size
                    else:
                        kept_count += 1

                    self.stats['total_files'] += 1

                except Exception as e:
                    print(f"  ERROR processing {filename}: {str(e)}")
                    self.stats['errors'] += 1

            self.stats['deleted_files'] += deleted_count
            self.stats['kept_files'] += kept_count
            self.stats['space_freed'] += space_freed
            self.stats['by_type']['options'] = {
                'deleted': deleted_count,
                'kept': kept_count,
                'space_freed': space_freed
            }

            print(f"\nSummary for options:")
            print(f"  Deleted: {deleted_count} files ({space_freed / (1024 * 1024):.2f} MB)")
            print(f"  Kept: {kept_count} files")

        rec_img_dir = os.path.join(self.cache_dir, 'recommendation_images')
        if os.path.exists(rec_img_dir):
            print(f"\n{'=' * 60}")
            print(f"Cleaning recommendation_images (TTL: 180 days)")
            print(f"{'=' * 60}")

            deleted_dirs = 0
            kept_dirs = 0
            space_freed = 0

            rec_dirs = [d for d in os.listdir(rec_img_dir) if os.path.isdir(os.path.join(rec_img_dir, d))]

            for rec_id in rec_dirs:
                rec_path = os.path.join(rec_img_dir, rec_id)
                manifest_path = os.path.join(rec_path, 'manifest.json')

                try:
                    age_seconds = 0
                    if os.path.exists(manifest_path):
                        age_seconds = self.get_file_age_seconds(manifest_path)
                    else:
                        oldest_file_mtime = time.time()
                        has_files = False
                        for f in os.listdir(rec_path):
                            fpath = os.path.join(rec_path, f)
                            if os.path.isfile(fpath):
                                has_files = True
                                file_mtime = os.path.getmtime(fpath)
                                if file_mtime < oldest_file_mtime:
                                    oldest_file_mtime = file_mtime
                        if has_files:
                            age_seconds = time.time() - oldest_file_mtime

                    if age_seconds > self.DEFAULT_EXPIRY['recommendation_images']:
                        age_str = self.format_age(age_seconds)

                        dir_size = sum(os.path.getsize(os.path.join(rec_path, f))
                                       for f in os.listdir(rec_path)
                                       if os.path.isfile(os.path.join(rec_path, f)))

                        if self.dry_run:
                            print(f"  [DRY RUN] Would delete dir: {rec_id} (age: {age_str}, size: {dir_size:,} bytes)")
                        else:
                            import shutil
                            shutil.rmtree(rec_path)
                            print(f"  DELETED dir: {rec_id} (age: {age_str}, size: {dir_size:,} bytes)")

                        deleted_dirs += 1
                        space_freed += dir_size
                    else:
                        kept_dirs += 1

                except Exception as e:
                    print(f"  ERROR processing {rec_id}: {str(e)}")
                    self.stats['errors'] += 1

            self.stats['by_type']['recommendation_images'] = {
                'deleted': deleted_dirs,
                'kept': kept_dirs,
                'space_freed': space_freed
            }

            print(f"\nSummary for recommendation_images:")
            print(f"  Deleted: {deleted_dirs} directories ({space_freed / (1024 * 1024):.2f} MB)")
            print(f"  Kept: {kept_dirs} directories")

    def run(self):
        print(f"\nCACHE CLEANER - {'DRY RUN' if self.dry_run else 'LIVE MODE'}")
        print(f"Cache directory: {self.cache_dir}")
        print(f"Current time: {datetime.now()}")

        for cache_type, ttl_seconds in self.DEFAULT_EXPIRY.items():
            if cache_type in ['options', 'recommendation_images']:
                continue
            self.clean_directory(cache_type, ttl_seconds)

        self.clean_special_directories()

        print(f"\n{'=' * 60}")
        print("FINAL SUMMARY")
        print(f"{'=' * 60}")

        # <-- START OF FIX
        img_stats = self.stats['by_type'].get('recommendation_images', {})
        img_kept = img_stats.get('kept', 0)
        img_deleted = img_stats.get('deleted', 0)

        total_items = self.stats['total_files'] + img_kept + img_deleted
        deleted_items = self.stats['deleted_files'] + img_deleted
        kept_items = self.stats['kept_files'] + img_kept

        print(f"Total items processed: {total_items:,}")

        action_word = "Would delete" if self.dry_run else "Deleted"
        print(f"Files/Dirs {action_word.lower()}: {deleted_items:,}")
        print(f"Files/Dirs kept: {kept_items:,}")
        # <-- END OF FIX

        print(f"Space freed: {self.stats['space_freed'] / (1024 * 1024):.2f} MB")
        print(f"Errors: {self.stats['errors']}")

        print("\nBreakdown by type:")
        for cache_type, type_stats in sorted(self.stats['by_type'].items()):
            deleted_label = "Dirs" if cache_type == 'recommendation_images' else "Files"
            kept_label = "Dirs" if cache_type == 'recommendation_images' else "Files"
            print(f"  {cache_type}:")
            print(f"    {action_word}: {type_stats.get('deleted', 0)} {deleted_label}")
            print(f"    Kept: {type_stats.get('kept', 0)} {kept_label}")
            print(f"    Space freed: {type_stats.get('space_freed', 0) / (1024 * 1024):.2f} MB")


if __name__ == "__main__":
    print("Cache Cleaner Utility")
    print("=" * 60)

    mode = input("\nRun in DRY RUN mode? (y/n): ").lower().strip()
    dry_run = mode != 'n'

    if not dry_run:
        confirm = input("\n⚠️  WARNING: This will DELETE files! Are you sure? (type 'DELETE' to confirm): ")
        if confirm != 'DELETE':
            print("Aborted. Running in dry run mode instead.")
            dry_run = True

    cleaner = CacheCleaner(cache_dir='cache', dry_run=dry_run)
    cleaner.run()

    if dry_run:
        print("\n" + "=" * 60)
        print("This was a DRY RUN. No files were deleted.")
        print("To run for real, answer 'n' to the dry run question.")