import re
from recommendation_prompts import (
    get_master_analytics_system_prompt,
    get_image_analytics_system_prompt,
    get_options_analytics_system_prompt,
    get_vibe_analytics_system_prompt,
    get_portfolio_system_prompt
)

# --- Configuration ---
# Set to True to hide the large JSON structures for a cleaner view.
# Set to False to see the full, unedited prompt.
MUTE_JSON = True

def mute_json_structures(prompt_text):
    """
    Finds and replaces large JSON structure definitions in the prompt text
    with a placeholder for better readability if MUTE_JSON is True.
    """
    if not MUTE_JSON:
        return prompt_text

    # Pattern 1: Catches the official, correctly formatted markdown JSON blocks.
    pattern1 = re.compile(
        r"(\w+\s(?:DATA|HISTORY|PERFORMANCE|PREDICTION|ANALYSIS|MODEL)\s+JSON\s+STRUCTURE:.*?)\n```json[\s\S]*?```"
    )

    # This function replaces the markdown block with a placeholder.
    def replacer(match):
        title = match.group(1).split(':')[0]
        return f"{match.group(1)}\n\n[... {title} has been muted for brevity ...]\n"

    # Apply the first pattern to mute the official blocks.
    prompt_text = pattern1.sub(replacer, prompt_text)

    # Pattern 2: (Corrected) Catches and removes the raw, un-wrapped JSON.
    # It looks for the word 'json' on its own line, followed by a JSON object '{...}',
    # and stops before it sees the next instructional line like '**Primary Directive'.
    pattern2 = re.compile(r"\njson\s*\{[\s\S]*?\n\}\n(?=\*\*|---)")

    # Apply the second pattern to remove the unwanted raw blocks entirely.
    prompt_text = pattern2.sub("", prompt_text)

    return prompt_text


def visualize_prompts():
    """
    Assembles and prints the final system prompts for all analyst types
    to allow for easy debugging and review of their structure and content.
    """

    # Dummy data for functions that require arguments.
    dummy_visualization_categories = {
        "SENTIMENT_TEMPORAL": 1,
        "SENTIMENT_COMBINED": 1,
        "SENTIMENT_RECENT": 0,
        "OPTIONS_ANALYSIS": 2,
        "PREDICTION_HISTORY": 1,
        "HISTORICAL_ANALYSIS": 0
    }

    print("========================================================================")
    print("=                 MONEY PRINTER - PROMPT VISUALIZER                  =")
    print(f"=                (JSON Muting is {'ON' if MUTE_JSON else 'OFF'})                 =")
    print("========================================================================")
    print("\nThis script displays the final system prompts sent to the AI models.\n")

    # --- Master Analyst Prompt ---
    print("\n\n########################################################################")
    print("#                      MASTER ANALYST SYSTEM PROMPT                      #")
    print("########################################################################\n")
    master_prompt = get_master_analytics_system_prompt(dummy_visualization_categories)
    print(mute_json_structures(master_prompt))

    # --- Image Analyst Prompt ---
    print("\n\n########################################################################")
    print("#                       IMAGE ANALYST SYSTEM PROMPT                      #")
    print("########################################################################\n")
    image_prompt = get_image_analytics_system_prompt()
    print(mute_json_structures(image_prompt))

    # --- Options Analyst Prompt ---
    print("\n\n########################################################################")
    print("#                      OPTIONS ANALYST SYSTEM PROMPT                     #")
    print("########################################################################\n")
    options_prompt = get_options_analytics_system_prompt()
    print(mute_json_structures(options_prompt))

    # --- Vibe Analyst Prompt ---
    print("\n\n########################################################################")
    print("#                        VIBE ANALYST SYSTEM PROMPT                      #")
    print("########################################################################\n")
    vibe_prompt = get_vibe_analytics_system_prompt()
    print(mute_json_structures(vibe_prompt))

    # --- Portfolio Analyst Prompt ---
    print("\n\n########################################################################")
    print("#                     PORTFOLIO ANALYST SYSTEM PROMPT                    #")
    print("########################################################################\n")
    portfolio_prompt = get_portfolio_system_prompt()
    print(mute_json_structures(portfolio_prompt))

    print("\n\n========================================================================")
    print("=                       END OF PROMPT VISUALIZATION                      =")
    print("========================================================================")

if __name__ == "__main__":
    visualize_prompts()