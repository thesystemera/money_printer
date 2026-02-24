import re
from services import log_service

class AnalysisService:
    _instance = None

    def __new__(cls, cache_service=None, config_service=None, ai_service=None):
        if cls._instance is None:
            cls._instance = super(AnalysisService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, cache_service=None, config_service=None, ai_service=None):
        if hasattr(self, '_initialized') and self._initialized:
            return

        self.config = config_service
        self.ai_service = ai_service
        self._last_relevance_cached = False
        self._last_sentiment_cached = False
        self.cache = cache_service
        self._initialized = True

    def was_last_relevance_cached(self):
        result = self._last_relevance_cached
        self._last_relevance_cached = False
        return result

    def was_last_sentiment_cached(self):
        result = self._last_sentiment_cached
        self._last_sentiment_cached = False
        return result

    def _get_model_for_analysis(self, use_turbo=True):
        if use_turbo:
            return "gpt-4o-mini"
        else:
            return "gemini-2.5-flash-lite"

    async def _call_ai_api(self, messages, model="gemini-2.5-flash-lite", temperature=0):
        if not self.ai_service:
            raise Exception("AI service is not initialized")

        if self.config and self.config.should_log_analysis_prompts():
            readable_prompt = "\n--- START OF PROMPT ---\n"
            for message in messages:
                readable_prompt += f"----- ROLE: {message['role'].upper()} -----\n{message['content']}\n"
            readable_prompt += "--- END OF PROMPT ---"
            await log_service.analysis(readable_prompt)

        try:
            provider = self.ai_service._infer_provider_from_model(model)
            response = await self.ai_service.call_api(
                messages=messages,
                model=model,
                temperature=temperature,
                with_thinking=False,
                save_debug=False,
                use_cache=False,
                ai_provider=provider
            )

            response_content = ""
            if response and hasattr(response, 'content'):
                for content_block in response.content:
                    if hasattr(content_block, 'type') and content_block.type == 'text':
                        response_content = content_block.text
                        break

            if self.config and self.config.should_log_analysis_prompts():
                readable_response = f"\n--- START OF RESPONSE ---\n{response_content}\n--- END OF RESPONSE ---"
                await log_service.analysis(readable_response)

            return response

        except Exception as e:
            await log_service.error(f"AI API call failed: {str(e)}")
            raise e

    async def is_article_relevant(self, publisher, headline, summary, company_name, company_symbol, company_ceo,
                                  article_url, use_turbo=True):
        self._last_relevance_cached = False

        cached_relevance = await self.cache.get_cached_relevance(headline, company_symbol)
        if cached_relevance is not None:
            self._last_relevance_cached = True
            status = "Related" if cached_relevance else "Unrelated"
            await log_service.analysis(f"Relevance: '{headline[:50]}...' → {company_symbol}: {status} (cached)")
            return cached_relevance

        if company_symbol == "GLOBAL_MARKET":
            prompt = (
                f"As a seasoned market analyst with deep domain knowledge, assess if this news has direct, substantial "
                f"impact on global market sentiment. Focus on news directly relevant to market conditions: monetary policy, economic indicators, geopolitical events, "
                f"significant sector trends, and regulatory changes with broad market implications. Categorize as 'Related' only if "
                f"moderate to high significance for overall market sentiment or major market sectors. Label 'Unrelated' if "
                f"isolated company news, peripheral events, or no clear, immediate connection to broader market movements.\n\n"
                f"Please respond with only 'Related' or 'Unrelated'.\n\n"
                f"Publisher: {publisher}\n"
                f"Headline: {headline}\n"
                f"Summary: {summary}\n"
            )
        elif company_symbol.startswith("INDUSTRY_"):
            original_symbol = company_symbol[9:]
            prompt = (
                f"As a seasoned industry analyst with deep domain knowledge of {company_name}'s industry, assess if this news has substantial "
                f"impact on the overall industry affecting {company_name} ({original_symbol}). "
                f"Focus on industry-wide developments: supply chains, competitive landscape shifts, "
                f"regulatory changes, technological innovations, and macroeconomic factors specific to this sector. "
                f"Look for news mentioning the industry broadly rather than just {company_name} specifically. "
                f"Categorize as 'Related' only if moderate to high significance for the overall sector "
                f"impacting {company_name}'s business environment. Label 'Unrelated' if "
                f"only about individual companies (including {company_name} itself), peripheral events, or no clear connection to broader industry dynamics.\n\n"
                f"Please respond with only 'Related' or 'Unrelated'.\n\n"
                f"Publisher: {publisher}\n"
                f"Headline: {headline}\n"
                f"Summary: {summary}\n"
            )
        else:
            prompt = (
                f"As a seasoned stock trader with deep domain knowledge, assess if this news has direct, substantial "
                f"impact on {company_name} ({company_symbol}) stock value. Focus on news directly relevant to {company_name}: "
                f"strategic leadership moves (particularly CEO {company_ceo}), competitive landscape developments, pivotal sector trends, and regulatory "
                f"changes with direct operational implications. Categorize as 'Related' only if "
                f"moderate to high significance for {company_name} or its immediate industry. Label 'Unrelated' if "
                f"general market news, peripheral competitors, or no clear, immediate connection to {company_name}'s core business.\n\n"
                f"Please respond with only 'Related' or 'Unrelated'.\n\n"
                f"Publisher: {publisher}\n"
                f"Headline: {headline}\n"
                f"Summary: {summary}\n"
            )

        model = self._get_model_for_analysis(use_turbo)

        response = await self._call_ai_api(
            messages=[{"role": "system", "content": prompt}],
            model=model,
            temperature=0
        )

        if not response:
            await log_service.error("AI relevance call returned None!")
            raise Exception("AI API returned None for relevance check")

        response_content = ""
        if response and hasattr(response, 'content'):
            for content_block in response.content:
                if hasattr(content_block, 'type') and content_block.type == 'text':
                    response_content = content_block.text.strip().lower()
                    break

        is_relevant = response_content == 'related'

        status = "Related" if is_relevant else "Unrelated"
        await log_service.analysis(f"Relevance: '{headline[:50]}...' → {company_symbol}: {status} ({model})")

        await self.cache.cache_relevance(headline, company_symbol, is_relevant)
        return is_relevant

    async def analyze_article_sentiment(self, publisher, headline, url, content, company_name, company_symbol,
                                        company_ceo, matched_keyword, use_turbo=True):
        self._last_sentiment_cached = False

        cached_analysis = await self.cache.get_cached_analysis(headline, company_symbol)
        if cached_analysis:
            self._last_sentiment_cached = True
            impact = cached_analysis.get('sentimentScore', 0)
            influence = cached_analysis.get('influenceScore', 0)
            duration = cached_analysis.get('impactDuration', 0)
            await log_service.analysis(
                f"Sentiment: '{headline[:50]}...' → {company_symbol}: Impact={impact:.2f}, Influence={influence:.2f}, Duration={duration}h (cached)")
            return cached_analysis

        if company_symbol == "GLOBAL_MARKET":
            prompt = (
                f"As a market analyst with deep domain knowledge and proven forecasting ability, analyze this news for direct and indirect impact on "
                f"overall market sentiment. Prioritize current, pertinent developments: economic indicators, monetary policy, geopolitical events, "
                f"and significant sector-wide trends influencing broader market direction.\n\n"
                f"Historical events provide context but have lower priority. "
                f"Focus on current and upcoming developments with direct impact on market sentiment and direction, "
                f"reflecting the market's forward-looking nature.\n\n"
                f"For articles unrelated to the specified criteria, all scores are set to zero.\n\n"
                f"Impact Score (-1.00 to 1.00): Projected influence of the news on "
                f"market sentiment and direction. -1.00 = highly detrimental news for the market, 0.00 = no expected impact, 1.00 = significantly positive implications for the market.\n\n"
                f"Influence Score (0.00 to 1.00): Impact potential of the news source based on "
                f"credibility and global reach. 0.00 = minimal or no impact on market perception, 1.00 = substantial influence on global financial markets.\n\n"
                f"Certainty Score (0.00 to 1.00): Confidence in the impact assessment based on information clarity and completeness. 0.00 = high uncertainty due to vague or ambiguous information, 1.00 = high confidence in a clear, unambiguous impact assessment.\n\n"
                f"News Propagation Speed: Time (in hours) for the news to reach peak market awareness. "
                f"Fast-breaking major news may spread in 1-4 hours, complex industry developments may take 12-48 hours to be fully comprehended by market participants.\n\n"
                f"News Impact Duration: Decay period (in hours) over which this news will gradually "
                f"diminish in market relevance after reaching peak awareness. Minor updates may fade within "
                f"12-24 hours, significant developments within 48-120 hours, fundamental business or "
                f"economic changes could influence trading for 168-720+ hours (1-4+ weeks).\n\n"
                f"Temporal Orientation (-1.00 to 1.00): Time focus of the news. -1.00 = entirely retrospective "
                f"(past events), 0.00 = current events happening now, 1.00 = entirely forward-looking (predictions, forecasts).\n\n"
                f"Source Category: Classify the publisher's type. Return 'INSTITUTIONAL' for major, established financial news agencies (e.g., Reuters, Bloomberg). Return 'RETAIL' for sources primarily targeting individual investors (e.g., Motley Fool, Yahoo Finance). Return 'AMBIGUOUS' for all others.\n\n"
                f"Format your response exactly as follows:\n"
                f"Impact Score: [score]\n"
                f"Influence Score: [score]\n"
                f"Certainty Score: [score]\n"
                f"News Propagation Speed: [hours]\n"
                f"News Impact Duration: [hours]\n"
                f"Temporal Orientation: [score]\n"
                f"Source Category: [category]\n"
            )
        elif company_symbol.startswith("INDUSTRY_"):
            original_symbol = company_symbol[9:]
            prompt = (
                f"As an industry analyst with deep domain knowledge of {company_name}'s industry, analyze this news "
                f"for potential impact on the entire industry affecting {company_name} ({original_symbol}). Focus on industry-level factors: "
                f"supply chain dynamics, regulatory changes, technological disruptions, competitive landscape shifts, and "
                f"broader economic factors specific to this sector.\n\n"
                f"Historical events provide context but have lower priority. Prioritize current and upcoming developments impacting "
                f"the industry's trajectory, reflecting the market's forward-looking nature. "
                f"Assess how these industry-wide trends could indirectly impact {company_name} through "
                f"effects on the broader sector.\n\n"
                f"For articles unrelated to the specified criteria, all scores are set to zero.\n\n"
                f"Impact Score (-1.00 to 1.00): Projected influence of the news on "
                f"the industry, particularly as it relates to {company_name}'s operating environment. "
                f"-1.00 = highly detrimental news for the industry, 0.00 = no expected impact, 1.00 = significantly positive implications.\n\n"
                f"Influence Score (0.00 to 1.00): Impact potential of the news source based on "
                f"credibility and reach within the industry sector. 0.00 = minimal or no impact on industry perception, 1.00 = substantial influence on industry stakeholders.\n\n"
                f"Certainty Score (0.00 to 1.00): Confidence in the impact assessment based on information clarity and completeness. 0.00 = high uncertainty due to vague or ambiguous information, 1.00 = high confidence in a clear, unambiguous impact assessment.\n\n"
                f"News Propagation Speed: Time (in hours) for the news to reach peak industry awareness. "
                f"Fast-breaking major news may spread in 1-4 hours, complex industry developments may take 12-48 hours to be fully comprehended by industry participants.\n\n"
                f"News Impact Duration: Decay period (in hours) over which this news will gradually "
                f"diminish in industry relevance after reaching peak awareness. Minor updates may fade within "
                f"12-24 hours, significant developments within 48-120 hours, fundamental industry "
                f"changes could influence sentiment for 168-720+ hours (1-4+ weeks).\n\n"
                f"Temporal Orientation (-1.00 to 1.00): Time focus of the news. -1.00 = entirely retrospective "
                f"(past events), 0.00 = current events happening now, 1.00 = entirely forward-looking (predictions, forecasts).\n\n"
                f"Source Category: Classify the publisher's type. Return 'INSTITUTIONAL' for major, established financial news agencies (e.g., Reuters, Bloomberg). Return 'RETAIL' for sources primarily targeting individual investors (e.g., Motley Fool, Yahoo Finance). Return 'AMBIGUOUS' for all others.\n\n"
                f"Format your response exactly as follows:\n"
                f"Impact Score: [score]\n"
                f"Influence Score: [score]\n"
                f"Certainty Score: [score]\n"
                f"News Propagation Speed: [hours]\n"
                f"News Impact Duration: [hours]\n"
                f"Temporal Orientation: [score]\n"
                f"Source Category: [category]\n"
            )
        else:
            prompt = (
                f"As a stock trader with deep domain knowledge and proven market forecasting ability, analyze this news for direct and indirect impact on "
                f"{company_name} ({company_symbol}) valuation. Prioritize current, pertinent developments "
                f"directly related to {company_name}, as well as broader industry trends and "
                f"significant competitor activities influencing {company_name}'s market position.\n\n"
                f"Historical events provide context but have lower priority. "
                f"Focus on current and upcoming developments with direct impact on {company_name}'s future "
                f"valuation, reflecting the market's forward-looking nature. "
                f"Consider news regarding {company_ceo}'s activities and their influence on {company_symbol} stock.\n\n"
                f"For articles unrelated to the specified criteria, all scores are set to zero.\n\n"
                f"Impact Score (-1.00 to 1.00): Projected influence of the news on "
                f"{company_name}'s trajectory. -1.00 = highly detrimental news, 0.00 = no expected impact, 1.00 = significantly positive implications.\n\n"
                f"Influence Score (0.00 to 1.00): Impact potential of the news source based on "
                f"credibility and global reach. 0.00 = minimal or no impact on market perception, 1.00 = substantial influence on global financial markets.\n\n"
                f"Certainty Score (0.00 to 1.00): Confidence in the impact assessment based on information clarity and completeness. 0.00 = high uncertainty due to vague or ambiguous information, 1.00 = high confidence in a clear, unambiguous impact assessment.\n\n"
                f"News Propagation Speed: Time (in hours) for the news to reach peak market awareness. "
                f"Fast-breaking major news may spread in 1-4 hours, complex industry developments may take 12-48 hours to be fully comprehended by market participants.\n\n"
                f"News Impact Duration: Decay period (in hours) over which this news will gradually "
                f"diminish in market relevance after reaching peak awareness. Minor updates may fade within "
                f"12-24 hours, significant developments within 48-120 hours, fundamental business or "
                f"economic changes could influence trading for 168-720+ hours (1-4+ weeks).\n\n"
                f"Temporal Orientation (-1.00 to 1.00): Time focus of the news. -1.00 = entirely retrospective "
                f"(past events), 0.00 = current events happening now, 1.00 = entirely forward-looking (predictions, forecasts).\n\n"
                f"Source Category: Classify the publisher's type. Return 'INSTITUTIONAL' for major, established financial news agencies (e.g., Reuters, Bloomberg). Return 'RETAIL' for sources primarily targeting individual investors (e.g., Motley Fool, Yahoo Finance). Return 'AMBIGUOUS' for all others.\n\n"
                f"Format your response exactly as follows:\n"
                f"Impact Score: [score]\n"
                f"Influence Score: [score]\n"
                f"Certainty Score: [score]\n"
                f"News Propagation Speed: [hours]\n"
                f"News Impact Duration: [hours]\n"
                f"Temporal Orientation: [score]\n"
                f"Source Category: [category]\n"
            )

        messages = [
            {"role": "system", "content": prompt},
            {"role": "user",
             "content": f"Headline: {headline}\n\nPublisher: {publisher}\n\nMatched Keyword: {matched_keyword}\n\nSummary: {content}\n"}
        ]

        model = self._get_model_for_analysis(use_turbo)

        response = await self._call_ai_api(messages=messages, model=model, temperature=0)

        if not response:
            await log_service.error("AI sentiment call returned None!")
            raise Exception("AI API returned None for sentiment analysis")

        response_content = ""
        if response and hasattr(response, 'content'):
            for content_block in response.content:
                if hasattr(content_block, 'type') and content_block.type == 'text':
                    response_content = content_block.text
                    break

        analysis_result = self._parse_sentiment_response(response_content)

        impact = analysis_result.get('sentimentScore', 0)
        influence = analysis_result.get('influenceScore', 0)
        duration = analysis_result.get('impactDuration', 0)
        await log_service.analysis(
            f"Sentiment: '{headline[:50]}...' → {company_symbol}: Impact={impact:.2f}, Influence={influence:.2f}, Duration={duration}h ({model})")

        await self.cache.cache_analysis(headline, company_symbol, analysis_result)
        return analysis_result

    def _parse_sentiment_response(self, response_content):
        score_matches = re.findall(r'Impact Score:\s*(-?\d+(?:\.\d{1,2})?)', response_content, re.IGNORECASE)
        influence_matches = re.findall(r'Influence Score:\s*(\d+(?:\.\d{1,2})?)', response_content, re.IGNORECASE)
        certainty_matches = re.findall(r'Certainty Score:\s*(\d+(?:\.\d{1,2})?)', response_content, re.IGNORECASE)
        speed_matches = re.findall(r'News Propagation Speed:\s*(\d+)', response_content, re.IGNORECASE)
        duration_matches = re.findall(r'News Impact Duration:\s*(\d+)', response_content, re.IGNORECASE)
        temporal_matches = re.findall(r'Temporal Orientation:\s*(-?\d+(?:\.\d{1,2})?)', response_content, re.IGNORECASE)
        category_matches = re.findall(r'Source Category:\s*(INSTITUTIONAL|RETAIL|AMBIGUOUS)', response_content, re.IGNORECASE)

        return {
            'sentimentScore': float(score_matches[0]) if score_matches else 0.0,
            'influenceScore': float(influence_matches[0]) if influence_matches else 0.0,
            'certaintyScore': float(certainty_matches[0]) if certainty_matches else 0.0,
            'propagationSpeed': int(speed_matches[0]) if speed_matches else 0,
            'impactDuration': int(duration_matches[0]) if duration_matches else 0,
            'temporalOrientation': float(temporal_matches[0]) if temporal_matches else 0.0,
            'sourceCategory': category_matches[0].upper() if category_matches else 'AMBIGUOUS',
            'analysis': response_content
        }