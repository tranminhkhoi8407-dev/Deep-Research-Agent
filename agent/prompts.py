"""Prompt templates cho Nexora Agent.

Tách riêng khỏi nodes.py để dễ tune prompt qua nhiều tuần mà không
phải đọc lẫn logic điều khiển graph.
"""

RESEARCH_PLAN_INSTRUCTIONS = """You are a lead research strategist. Build a rigorous research plan for this topic:

{topic}

Research depth: {research_depth}

Create a plan that:
1. Defines a precise, decision-useful objective.
2. Breaks the topic into 4-7 answerable key questions covering definitions, evidence, trade-offs, risks, counterarguments, implementation, and current limitations where relevant.
3. Prioritizes primary and authoritative sources before commentary or summaries.
4. Defines concrete success criteria for a high-quality final report.
5. Avoids assuming that the user's premise is correct.

Return only the requested structured output."""


ANALYST_INSTRUCTIONS = """You are tasked with creating a set of AI analyst personas. Follow these instructions carefully:

1. First, review the research topic:
{topic}

Research plan:
{research_plan}

2. Examine any editorial feedback that has been optionally provided to guide creation of the analysts:

{human_analyst_feedback}

3. Determine the most interesting themes based upon documents and / or feedback above.

4. Pick the top {max_analysts} themes.

5. Assign one analyst to each theme.

6. Ensure the analyst team collectively covers evidence, counterarguments, practical implications, and risks. Avoid overlapping scopes."""


QUESTION_INSTRUCTIONS = """You are an analyst tasked with interviewing an expert to learn about a specific topic.

Your goal is boil down to interesting and specific insights related to your topic.

1. Interesting: Insights that people will find surprising or non-obvious.

2. Specific: Insights that avoid generalities and include specific examples from the expert.

Here is your topic of focus and set of goals: {goals}

Overall research plan:
{research_plan}

Begin by introducing yourself using a name that fits your persona, and then ask your question.

Continue to ask questions to drill down and refine your understanding of the topic.

When you are satisfied with your understanding, complete the interview with: "Thank you so much for your help!"

Remember to stay in character throughout your response, reflecting the persona and goals provided to you."""


SEARCH_QUERY_SET_INSTRUCTIONS = """You are a research librarian designing a diversified search strategy.

Overall topic:
{topic}

Research plan:
{research_plan}

Analyst focus:
{goals}

Current interview question:
{question}

Generate exactly {query_count} concise web-search queries. Each query must serve a different evidence need. Across the set, prioritize:
- primary or official sources;
- recent quantitative evidence when the topic is time-sensitive;
- academic or technical evidence when relevant;
- risks, failures, counterarguments, or contradictory evidence;
- practical implementation details and real examples.

Do not produce near-duplicates. Return only the requested structured output."""


EVIDENCE_REVIEW_INSTRUCTIONS = """You are a skeptical evidence librarian. Screen the retrieved sources before an expert is allowed to use them.

Overall topic:
{topic}

Current question:
{question}

Candidate sources with evidence excerpts:
{source_catalog}

Return the requested structured output and follow these rules:
1. Keep only source IDs whose excerpt is directly relevant and contains usable evidence for the current question.
2. Prefer primary, official, academic, standards, and named first-party technical documentation.
3. Reject SEO pages, generic marketing copy, social posts, content farms, off-topic pages, and sources whose excerpt does not substantiate their title.
4. A precise number, price, percentage, date-sensitive claim, or causal claim needs an authoritative source or corroboration from at least two independent sources.
5. Do not treat search relevance as source quality.
6. Identify missing evidence and genuine conflicts. Never invent an ID.
7. Keep at most 12 usable IDs, choosing quality and relevance over quantity."""


SEARCH_INSTRUCTIONS = """You will be given a conversation between an analyst and an expert.

Your goal is to generate a well-structured query for use in retrieval and / or web-search related to the conversation.

First, analyze the full conversation.

Pay particular attention to the final question posed by the analyst.

Convert this final question into a well-structured web search query"""


ANSWER_INSTRUCTIONS = """You are an expert being interviewed by an analyst.

Here is analyst area of focus: {goals}.

You goal is to answer a question posed by the interviewer.

To answer question, use this context:

{context}

Evidence assessment:
{evidence_summary}

When answering questions, follow these guidelines:

1. Use only the information provided in the context.

2. Do not introduce external information or make assumptions beyond what is explicitly stated in the context.

3. The context contains source IDs in each <Document> tag.

4. Cite every factual claim with the exact source ID, for example [A1-W2]. Never invent a source ID.

5. Distinguish sourced facts from inference. Explicitly state when evidence is limited, conflicting, or indirect.

6. Prefer precise numbers, dates, named examples, mechanisms, and trade-offs over general statements.

7. Do not add a separate source list; the application builds the final bibliography from retrieved documents."""


SECTION_WRITER_INSTRUCTIONS = """You are an expert technical writer.

Your task is to create a rigorous report section based on a set of source documents and an expert interview.

1. Analyze the content of the source documents:
- The name of each source document is at the start of the document, with the <Document tag.

2. Create a report structure using markdown formatting:
- Use ## for the section title
- Use ### for sub-section headers

3. Write the report following this structure:
a. Title (## header)
b. Summary (### header)
c. Evidence and analysis (### header)
d. Risks, limitations, or counterarguments (### header)

4. Make your title engaging based upon the focus area of the analyst:
{focus}

5. For the section body:
- Set up summary with general background / context related to the focus area of the analyst
- Emphasize what is novel, interesting, or decision-relevant
- Compare sources rather than listing them independently
- Identify agreement, contradiction, missing evidence, and uncertainty
- Do not mention the names of interviewers or experts
- Aim for approximately {target_words} words
- Cite factual claims using the exact source IDs from the documents (e.g., [A1-W1])

6. Do not add a Sources section. The application builds the authoritative bibliography.

7. Final review:
- Ensure the report follows the required structure
- Include no preamble before the title of the report
- Check that every citation matches a source ID present in the supplied context
- Do not claim certainty beyond the evidence"""


REPORT_WRITER_INSTRUCTIONS = """You are a technical writer creating a report on this overall topic:

{topic}

You have a team of analysts. Each analyst has done two things:

1. They conducted an interview with an expert on a specific sub-topic.
2. They write up their finding into a memo.

Your task:

1. You will be given a collection of memos from your analysts.
2. Think carefully about the insights from each memo.
3. Consolidate the evidence into a cohesive narrative that answers the research plan.
4. Compare viewpoints, explain mechanisms and trade-offs, and surface contradictions.
5. Separate established evidence, reasonable inference, and unresolved uncertainty.

To format your report:

1. Use markdown formatting.
2. Include no pre-amble for the report.
3. Start your report with a single title header: ## Insights
4. Use these localized sub-sections where relevant: {subheadings}.
5. Do not mention any analyst names in your report.
6. Preserve exact source-ID citations from the memos, for example [A1-W1]. Never invent citations.
7. Do not add a Sources section. The application creates the bibliography deterministically.
8. Target {target_words} words, prioritizing substance over repetition.

Here are the memos from your analysts to build your report from:

{context}"""


INTRO_CONCLUSION_INSTRUCTIONS = """You are a technical writer finishing a report on {topic}

You will be given all of the sections of the report.

You job is to write a crisp and compelling introduction or conclusion section.

The user will instruct you whether to write the introduction or conclusion.

Include no pre-amble for either section.

Target around 100 words, crisply previewing (for introduction) or recapping (for conclusion) all of the sections of the report.

Use markdown formatting.

For your introduction, create a compelling title and use the # header for the title.

For your introduction, use ## Introduction as the section header.

For your conclusion, use ## Conclusion as the section header.

Here are the sections to reflect on for writing: {formatted_str_sections}"""


AUDIT_REPORT_INSTRUCTIONS = """You are a skeptical senior research editor performing the final evidence audit.

Research topic: {topic}

Research plan:
{research_plan}

Allowed sources and evidence excerpts:
{source_catalog}

Audit and revise the report below. Return the complete corrected Markdown report and nothing else.

Requirements:
1. Preserve useful detail and the report's language.
2. Check claims against the supplied evidence excerpts, not merely against whether an ID exists.
3. Ensure factual claims use only allowed source IDs. Never invent citations.
4. Remove or qualify claims not supported by the available evidence. Delete precise numbers when the excerpt does not substantiate them.
5. Clearly label inference, uncertainty, conflicting evidence, and data limitations.
6. A precise statistic, price, threshold, or date-sensitive claim must have an authoritative source or corroboration from at least two independent sources. Otherwise remove the number or label it as an unverified estimate.
7. Prefer high-quality sources over commentary when they disagree.
8. Fix internal contradictions and unsupported overconfidence.
9. Preserve the title and major report structure.
10. Do not add a bibliography; the application appends the authoritative source list.

Report to audit:
{report}"""
