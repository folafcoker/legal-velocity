import re, json
from datetime import datetime
from collections import defaultdict

# ─────────────────────────────────────────────────────────────────────────────
#  NEW FORMAT: "Person sent for approval Template with Doc"
#  The RECIPIENT is the actor shown:
#    "Elaine sent for approval …"    → doc arrived at Elaine   → TURN STARTS
#    "Ryan sent for approval …"      → doc arrived at Ryan     → TURN ENDS
#
#  Minimum turn duration = 10 min to filter out parallel-approver duplicates
#  (e.g. Elaine + Camilla both get it at 23:03 → Camilla at same ts ≠ turn close)
# ─────────────────────────────────────────────────────────────────────────────

RAW = """Camilla Bier sent for approval Customer - POC Agreement with Granola_BCV_POC 3.24.docx
9 Apr 18:43
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with G2, Granola - Enterprise Order Form with Platform Terms 2026.docx
9 Apr 14:58
elaine@granola.so
Palmer Foster sent for approval Enterprise Order Form with Platform Terms with G2, Granola - Enterprise Order Form with Platform Terms 2026.docx
9 Apr 14:58
palmer@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Komodo Health + Granola - MSA
9 Apr 13:20
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Posthog, Granola - Enterprise Order Form with Platform Terms 2026.docx
9 Apr 13:04
elaine@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Komodo Health + Granola - MSA
9 Apr 06:26
ryan@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Optimizely, Granola - Enterprise Order Form with Platform Terms.docx
9 Apr 00:29
ernesto@granola.so
Bob Kamburov sent for approval Enterprise Order Form with Platform Terms with Granola Gladly Platform Terms 03 31 26 Gladly redline.docx
8 Apr 23:43
bob@granola.so
Camilla Bier sent for approval Customer - POC Agreement with Granola_BCV_POC 3.24.docx
8 Apr 23:25
camilla@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Optimizely, Granola - Enterprise Order Form with Platform Terms.docx
8 Apr 23:04
ernesto@granola.so
Palmer Foster sent for approval Granola MNDA Template with Barrenjoey & Granola Commercial MNDA (1).docx
8 Apr 22:32
palmer@granola.so
Palmer Foster sent for approval Granola MNDA Template with Barrenjoey & Granola Commercial MNDA (1).docx
8 Apr 22:31
palmer@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Harvey + Granola - Enterprise Order Form with Platform Terms Jan 2026 (Harvey 3.April.2026) .docx
8 Apr 21:33
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
8 Apr 21:27
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with CharlesBank, Granola - Enterprise Order Form with Platform Terms 2026.docx
8 Apr 19:30
camilla@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
8 Apr 19:22
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola Gladly Platform Terms 03 31 26 Gladly redline.docx
8 Apr 18:01
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Order Form with Platform Terms (Tatari rev 3.23.26).docx
8 Apr 17:25
camilla@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with DevRev Order Form.docx
8 Apr 17:09
ernesto@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
8 Apr 16:43
elaine@granola.so
Elaine Foreman sent for approval Customer - POC Agreement with Granola_BCV_POC 3.24.docx
8 Apr 14:00
elaine@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
8 Apr 13:58
ernesto@granola.so
Elaine Foreman sent for approval Granola MNDA Template with Barrenjoey & Granola Commercial MNDA (1).docx
8 Apr 13:51
elaine@granola.so
Palmer Foster sent for approval Granola MNDA Template with Barrenjoey & Granola Commercial MNDA (1).docx
8 Apr 13:51
palmer@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
8 Apr 10:56
elaine@granola.so
Bob Kamburov sent for approval Enterprise Order Form with Platform Terms with Granola Gladly Platform Terms 03 31 26 Gladly redline.docx
7 Apr 21:33
bob@granola.so
Bob Kamburov sent for approval Enterprise Order Form with Platform Terms with Granola Gladly Platform Terms 03 31 26 Gladly redline.docx
7 Apr 20:37
bob@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Komodo Health + Granola - MSA
7 Apr 18:13
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Optimizely, Granola - Enterprise Order Form with Platform Terms.docx
7 Apr 17:50
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with CharlesBank, Granola - Enterprise Order Form with Platform Terms 2026.docx
7 Apr 16:32
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with CharlesBank, Granola - Enterprise Order Form with Platform Terms 2026.docx
7 Apr 16:01
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Order Form with Platform Terms (Tatari rev 3.23.26).docx
7 Apr 13:18
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with DevRev Order Form.docx
4 Apr 19:14
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola Gladly Platform Terms 03 31 26 Gladly redline.docx
3 Apr 19:06
elaine@granola.so
Nick Taylor sent for approval Enterprise Order Form with Platform Terms with a16z Granola - Renewal [a16z Comments 3.23].docx
3 Apr 15:19
nicktaylor@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with a16z Granola - Renewal [a16z Comments 3.23].docx
3 Apr 15:19
ryan@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Optimizely, Granola - Enterprise Order Form with Platform Terms.docx
3 Apr 03:11
ernesto@granola.so
Nick Taylor sent for approval Enterprise Order Form with Platform Terms with a16z Granola - Renewal [a16z Comments 3.23].docx
3 Apr 02:41
nicktaylor@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with a16z Granola - Renewal [a16z Comments 3.23].docx
3 Apr 02:41
ryan@granola.so
Bob Kamburov sent for approval Enterprise Order Form with Platform Terms with Granola Gladly Platform Terms 03 31 26 Gladly redline.docx
3 Apr 02:12
bob@granola.so
Bob Kamburov sent for approval Enterprise Order Form with Platform Terms with Granola Gladly Platform Terms 03 31 26 Gladly redline.docx
3 Apr 02:02
bob@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
2 Apr 23:01
ernesto@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
2 Apr 21:21
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Optimizely, Granola - Enterprise Order Form with Platform Terms.docx
2 Apr 21:18
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
2 Apr 17:34
elaine@granola.so
Palmer Foster sent for approval Enterprise Order Form with Platform Terms with Granola New Imagitas, Inc., operating as Red Ventures Productiv_Intake 09-03-2025 (4).docx
2 Apr 05:57
palmer@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
2 Apr 05:36
ryan@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
2 Apr 05:36
camilla@granola.so
Palmer Foster sent for approval Granola MNDA Template with Barrenjoey & Granola Commercial MNDA (1).docx
2 Apr 05:30
palmer@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with DevRev Order Form.docx
2 Apr 05:23
ernesto@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
1 Apr 23:03
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
1 Apr 23:03
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola New Imagitas, Inc., operating as Red Ventures Productiv_Intake 09-03-2025 (4).docx
1 Apr 19:22
elaine@granola.so
Elaine Foreman sent for approval Granola - Short Order Form Template with AssemblyAI - Granola Order Form.docx
1 Apr 18:19
elaine@granola.so
Elaine Foreman sent for approval Granola MNDA Template with Barrenjoey & Granola Commercial MNDA (1).docx
1 Apr 16:05
elaine@granola.so
Ernesto Andaya sent for approval Granola - Short Order Form Template with EF Order Form (1) (2).docx
1 Apr 15:10
ernesto@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola Gladly Platform Terms 03 31 26 Gladly redline.docx
1 Apr 01:37
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with DevRev Order Form.docx
1 Apr 00:16
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with CharlesBank, Granola - Enterprise Order Form with Platform Terms 2026.docx
1 Apr 00:11
camilla@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with CharlesBank, Granola - Enterprise Order Form with Platform Terms 2026.docx
1 Apr 00:11
fola@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with DevRev Order Form.docx
31 Mar 23:58
ernesto@granola.so
Palmer Foster sent for approval Granola - Short Order Form Template with Docker Granola Order Form.docx
31 Mar 22:46
palmer@granola.so
Palmer Foster sent for approval Granola - Short Order Form Template with Docker Granola Order Form.docx
31 Mar 21:31
palmer@granola.so
Ernesto Andaya sent for approval Customer MNDA Template (3rd Party) with ID 53162 Granola Confidentiality Agreement Mar 27 2026.docx
31 Mar 21:16
ernesto@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with G2, Granola - Enterprise Order Form with Platform Terms 2026.docx
31 Mar 21:09
fola@granola.so
Ernesto Andaya sent for approval Granola - Short Order Form Template with EF Order Form (1) (2).docx
31 Mar 16:47
ernesto@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with DevRev Order Form.docx
31 Mar 15:02
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
31 Mar 07:40
camilla@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
31 Mar 07:40
ryan@granola.so
Camilla Bier sent for approval Customer - POC Agreement with Granola_BCV_POC 3.24.docx
31 Mar 07:13
camilla@granola.so
Will Sander sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms Jan 2026 (1).docx
31 Mar 06:34
will@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms Jan 2026 (1).docx
31 Mar 06:34
ernesto@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Posthog, Granola - Enterprise Order Form with Platform Terms 2026.docx
31 Mar 05:25
fola@granola.so
Ernesto Andaya sent for approval Granola - Short Order Form Template with EF Order Form (1) (2).docx
31 Mar 00:00
ernesto@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Customer - POC Agreement with Granola AI Pilot Agreement Citadel Comments 3.13.26.docx
30 Mar 23:55
fola@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Customer - POC Agreement with Granola AI Pilot Agreement Citadel Comments 3.13.26.docx
30 Mar 23:54
fola@granola.so
Elaine Foreman sent for approval Customer - POC Agreement with Granola AI Pilot Agreement Citadel Comments 3.13.26.docx
30 Mar 23:54
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with G2, Granola - Enterprise Order Form with Platform Terms 2026.docx
30 Mar 21:25
elaine@granola.so
Elaine Foreman sent for approval Customer - POC Agreement with Granola AI Pilot Agreement Citadel Comments 3.13.26.docx
30 Mar 21:06
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Customer - POC Agreement with Granola AI Pilot Agreement Citadel Comments 3.13.26.docx
30 Mar 20:52
fola@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Amplitude, Inc.
30 Mar 20:31
ryan@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with a16z Granola - Renewal [a16z Comments 3.23].docx
30 Mar 20:19
ryan@granola.so
Elaine Foreman sent for approval Granola - Short Order Form Template with Docker Granola Order Form.docx
30 Mar 20:10
elaine@granola.so
Elaine Foreman sent for approval Granola - Short Order Form Template with EF Order Form (1) (2).docx
30 Mar 15:07
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
30 Mar 06:50
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Amplitude, Inc.
29 Mar 21:33
elaine@granola.so
Elaine Foreman sent for approval Customer - POC Agreement with Granola AI Pilot Agreement Citadel Comments 3.13.26.docx
29 Mar 16:36
elaine@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Komodo Health + Granola - MSA
28 Mar 04:59
ryan@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
28 Mar 04:47
ernesto@granola.so
Will Sander sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - K1 - Redline.docx
28 Mar 04:44
will@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with 9Fin Granola - Enterprise Order Form (9fin_ 2026.03.19).docx
28 Mar 04:38
fola@granola.so
Elaine Foreman sent for approval Customer MNDA Template (3rd Party) with ID 53162 Granola Confidentiality Agreement Mar 27 2026.docx
27 Mar 22:37
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
27 Mar 22:36
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Order Form with Platform Terms (Tatari rev 3.23.26).docx
27 Mar 21:08
camilla@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Customer - POC Agreement with Granola AI Pilot Agreement Citadel Comments 3.13.26.docx
27 Mar 20:03
fola@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Posthog, Granola - Enterprise Order Form with Platform Terms 2026.docx
27 Mar 19:57
fola@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Amplitude, Inc.
27 Mar 17:31
ryan@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with a16z Granola - Renewal [a16z Comments 3.23].docx
26 Mar 21:50
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Komodo Health + Granola - MSA
26 Mar 21:43
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Amplitude, Inc.
26 Mar 21:33
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with CharlesBank, Granola - Enterprise Order Form with Platform Terms 2026.docx
26 Mar 20:52
elaine@granola.so
Elaine Foreman sent for approval Customer - POC Agreement with Granola_BCV_POC 3.24.docx
26 Mar 17:41
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms Jan 2026 (1).docx
26 Mar 15:24
elaine@granola.so
Elaine Foreman sent for approval Customer MNDA Template (3rd Party) with MNDA Form 2020 (1).docx
26 Mar 12:09
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with 9Fin Granola - Enterprise Order Form (9fin_ 2026.03.19).docx
26 Mar 11:13
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Posthog, Granola - Enterprise Order Form with Platform Terms 2026.docx
26 Mar 08:43
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with G2, Granola - Enterprise Order Form with Platform Terms 2026.docx
25 Mar 20:06
fola@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Justworks Granola MSA
25 Mar 19:32
ryan@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with G2, Granola - Enterprise Order Form with Platform Terms 2026.docx
25 Mar 17:02
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Justworks Granola MSA
25 Mar 16:54
elaine@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Amplitude, Inc.
25 Mar 15:49
ryan@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
25 Mar 15:34
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Amplitude, Inc.
25 Mar 11:53
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
25 Mar 10:23
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
25 Mar 05:30
camilla@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Amplitude, Inc.
25 Mar 05:28
ryan@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Komodo Health + Granola - MSA
25 Mar 05:00
ryan@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Customer MNDA Template (3rd Party) with M&G - MNDA (with DC-DP provisions) - (Oct 2020) (3).docx
25 Mar 03:53
fola@granola.so
Ernesto Andaya sent for approval Granola MNDA Template with Alpha Sense
25 Mar 03:29
ernesto@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Litera Compare Redline - Granola - Enterprise Order Form - TA and Granola - Enterprise Order Form - TA [TA Legal Comments 3.19.26].docx
25 Mar 03:24
camilla@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with CharlesBank, Granola - Enterprise Order Form with Platform Terms 2026.docx
25 Mar 03:22
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
24 Mar 21:50
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
24 Mar 21:12
camilla@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
24 Mar 20:37
ernesto@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with G2, Granola - Enterprise Order Form with Platform Terms 2026.docx
24 Mar 19:23
fola@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with 9Fin Granola - Enterprise Order Form (9fin_ 2026.03.19).docx
24 Mar 17:24
fola@granola.so
Elaine Foreman sent for approval Customer - POC Agreement with Granola AI Pilot Agreement Citadel Comments 3.13.26.docx
24 Mar 16:29
elaine@granola.so
Will Sander sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - K1 - Redline.docx
24 Mar 15:13
will@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
24 Mar 11:03
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with a16z Granola - Renewal [a16z Comments 3.23].docx
23 Mar 22:13
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola Checkr Enterprise Order Form 3.18.26 docx.docx
23 Mar 21:49
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Order Form with Platform Terms (Tatari rev 3.23.26).docx
23 Mar 21:37
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Litera Compare Redline - Granola - Enterprise Order Form - TA and Granola - Enterprise Order Form - TA [TA Legal Comments 3.19.26].docx
23 Mar 21:35
elaine@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
23 Mar 20:25
ernesto@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Amplitude, Inc.
23 Mar 18:32
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Amplitude, Inc.
23 Mar 18:31
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Komodo Health + Granola - MSA
23 Mar 13:56
elaine@granola.so
Elaine Foreman sent for approval Customer MNDA Template (3rd Party) with MNDA Form 2020.docx
23 Mar 13:33
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
23 Mar 10:21
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
23 Mar 09:27
elaine@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Justworks Granola MSA
23 Mar 06:30
ryan@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Justworks Granola MSA
20 Mar 20:14
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola Checkr Enterprise Order Form 3.18.26 docx.docx
20 Mar 19:30
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with CharlesBank, Granola - Enterprise Order Form with Platform Terms 2026.docx
20 Mar 19:20
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Litera Compare Redline - Granola - Enterprise Order Form - TA and Granola - Enterprise Order Form - TA [TA Legal Comments 3.19.26].docx
20 Mar 18:43
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola Checkr Enterprise Order Form 3.18.26 docx.docx
20 Mar 17:41
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola Checkr Enterprise Order Form 3.18.26 docx.docx
20 Mar 17:39
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with G2, Granola - Enterprise Order Form with Platform Terms 2026.docx
20 Mar 15:40
elaine@granola.so
Elaine Foreman sent for approval Customer MNDA Template (3rd Party) with M&G - MNDA (with DC-DP provisions) - (Oct 2020) (3).docx
20 Mar 15:27
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Posthog, Granola - Enterprise Order Form with Platform Terms 2026.docx
20 Mar 14:57
elaine@granola.so
Elaine Foreman sent for approval Granola MNDA Template with Alpha Sense
20 Mar 14:45
elaine@granola.so
Ernesto Andaya sent for approval Customer MNDA Template (3rd Party) with PAGERDUTY-MUTUAL-NONDISCLOSURE-AGREEMENT-2022.docx
20 Mar 04:27
ernesto@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Posthog, Granola - Enterprise Order Form with Platform Terms 2026.docx
20 Mar 04:26
fola@granola.so
Elaine Foreman sent for approval Customer MNDA Template (3rd Party) with PAGERDUTY-MUTUAL-NONDISCLOSURE-AGREEMENT-2022.docx
20 Mar 00:51
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Litera Compare Redline - Granola - Enterprise Order Form - TA and Granola - Enterprise Order Form - TA [TA Legal Comments 3.19.26].docx
19 Mar 22:25
elaine@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Justworks Granola MSA
19 Mar 19:15
ryan@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola Checkr Enterprise Order Form 3.18.26 docx.docx
19 Mar 18:04
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with 9Fin Granola - Enterprise Order Form (9fin_ 2026.03.19).docx
19 Mar 17:23
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola Checkr Enterprise Order Form 3.18.26 docx.docx
19 Mar 14:55
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - K1 - Redline.docx
19 Mar 13:32
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola Checkr Enterprise Order Form 3.18.26 docx.docx
19 Mar 04:27
camilla@granola.so
Camilla Bier sent for approval Customer MNDA Template (3rd Party) with Granola_BCV_MNDA_3.18.2026.docx
19 Mar 03:38
camilla@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
19 Mar 03:32
ernesto@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola Checkr Enterprise Order Form 3.18.26 docx.docx
18 Mar 20:52
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Justworks Granola MSA
18 Mar 19:41
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Chainguard, Granola - Enterprise Order Form 2026.docx
18 Mar 18:09
fola@granola.so
Elaine Foreman sent for approval Customer MNDA Template (3rd Party) with Granola_BCV_MNDA_3.18.2026.docx
18 Mar 18:02
elaine@granola.so
Ernesto Andaya sent for approval Customer MNDA Template (3rd Party) with Airtable MNDA.pdf
18 Mar 16:16
ernesto@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Chainguard, Granola - Enterprise Order Form 2026.docx
18 Mar 13:54
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola PandaDoc - Enterprise Order Form with Platform Terms Jan 2026 [PD RL 3.16.26].docx
18 Mar 01:32
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Justworks Granola MSA
17 Mar 21:34
elaine@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Justworks Granola MSA
17 Mar 21:34
ryan@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola_-_Enterprise_Order_Form_-_Mozilla_Mozilla_Marks12.15.25.docx
17 Mar 21:24
camilla@granola.so
Elaine Foreman sent for approval Customer MNDA Template (3rd Party) with Airtable MNDA.pdf
17 Mar 21:16
elaine@granola.so
Elaine Foreman sent for approval Customer MNDA Template (3rd Party) with Airtable MNDA.pdf
17 Mar 20:49
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola_-_Enterprise_Order_Form_-_Mozilla_Mozilla_Marks12.15.25.docx
17 Mar 20:02
camilla@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Redline - Granola Contract (TR 03-06-26) (1).docx
17 Mar 19:12
ernesto@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola_-_Enterprise_Order_Form_-_Mozilla_Mozilla_Marks12.15.25.docx
17 Mar 19:00
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola_-_Enterprise_Order_Form_-_Mozilla_Mozilla_Marks12.15.25.docx
17 Mar 18:51
camilla@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Justworks Granola MSA
17 Mar 18:28
ryan@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Posthog, Granola - Enterprise Order Form with Platform Terms 2026.docx
17 Mar 17:57
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Redline - Granola Contract (TR 03-06-26) (1).docx
17 Mar 17:44
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Chainguard, Granola - Enterprise Order Form 2026.docx
17 Mar 17:20
fola@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Justworks Granola MSA
17 Mar 11:56
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Justworks Granola MSA
17 Mar 11:45
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Chainguard, Granola - Enterprise Order Form 2026.docx
17 Mar 11:16
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola_-_Enterprise_Order_Form_-_Mozilla_Mozilla_Marks12.15.25.docx
17 Mar 10:29
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Customer - POC Agreement with Granola AI Pilot Agreement Citadel Comments 3.13.26.docx
17 Mar 05:22
fola@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Chainguard, Granola - Enterprise Order Form 2026.docx
17 Mar 04:40
fola@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Redline - Granola Contract (TR 03-06-26) (1).docx
17 Mar 04:05
ernesto@granola.so
Ernesto Andaya sent for approval Enterprise Order Form with Platform Terms with Redline - Granola Contract (TR 03-06-26) (1).docx
17 Mar 04:04
ernesto@granola.so
Ryan Francis sent for approval Enterprise Order Form with Platform Terms with Amplitude, Inc.
16 Mar 19:58
ryan@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
16 Mar 17:58
camilla@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
16 Mar 17:41
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola_MSA+OF_JWrev3.12.2026 (1).docx
16 Mar 14:19
elaine@granola.so
Elaine Foreman sent for approval Customer - POC Agreement with Granola AI Pilot Agreement Citadel Comments 3.13.26.docx
13 Mar 19:19
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Chainguard, Granola - Enterprise Order Form 2026.docx
13 Mar 19:02
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
13 Mar 17:23
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
13 Mar 17:22
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Redline - Granola Contract (TR 03-06-26) (1).docx
13 Mar 16:50
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
12 Mar 23:56
camilla@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Astronomer.io, Granola - Enterprise Order Form 2026.docx
12 Mar 23:35
fola@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
12 Mar 23:29
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Astronomer.io, Granola - Enterprise Order Form 2026.docx
12 Mar 23:22
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Astronomer.io, Granola - Enterprise Order Form 2026.docx
12 Mar 23:11
fola@granola.so
Camilla Bier sent for approval Default with Pinterest DPA
12 Mar 22:05
camilla@granola.so
Camilla Bier sent for approval Default with Pinterest Security Exhibit
12 Mar 22:00
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
12 Mar 16:44
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Customer.io, Granola REDLINE Enterprise Order Form - CIO edits (February 25, 2026).docx
12 Mar 15:32
fola@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Astronomer.io, Granola - Enterprise Order Form 2026.docx
12 Mar 15:32
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
11 Mar 22:04
elaine@granola.so
Elaine Foreman sent for approval Default with Pinterest DPA
11 Mar 19:57
elaine@granola.so
Elaine Foreman sent for approval Default with Pinterest Security Exhibit
11 Mar 19:50
elaine@granola.so
Elaine Foreman sent for approval Default with Pinterest Security Exhibit
11 Mar 19:48
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
11 Mar 18:26
camilla@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Thumbtack Order Form
11 Mar 18:09
camilla@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Thumbtack Order Form
11 Mar 17:26
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Thumbtack Order Form
11 Mar 10:31
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Customer.io, Granola REDLINE Enterprise Order Form - CIO edits (February 25, 2026).docx
11 Mar 09:27
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
11 Mar 07:54
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
11 Mar 07:50
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Customer MNDA Template (3rd Party) with M&G - MNDA (with DC-DP provisions) - (Oct 2020) (3).docx
11 Mar 03:07
fola@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
11 Mar 02:48
camilla@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Chainguard, Granola - Enterprise Order Form 2026.docx
11 Mar 02:28
fola@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
10 Mar 10:38
elaine@granola.so
Elaine Foreman sent for approval Customer MNDA Template (3rd Party) with M&G - MNDA (with DC-DP provisions) - (Oct 2020) (3).docx
10 Mar 10:18
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
10 Mar 01:52
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
9 Mar 23:20
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Thumbtack Order Form
9 Mar 23:17
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
9 Mar 23:13
camilla@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Thumbtack Order Form
9 Mar 22:15
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Thumbtack Order Form
9 Mar 21:48
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Thumbtack Order Form
9 Mar 21:18
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form with Platform Terms (PCIG Comments).docx
9 Mar 20:14
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Chainguard, Granola - Enterprise Order Form 2026.docx
9 Mar 08:55
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
8 Mar 21:55
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Customer.io, Granola REDLINE Enterprise Order Form - CIO edits (February 25, 2026).docx
6 Mar 23:36
fola@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Customer.io, Granola REDLINE Enterprise Order Form - CIO edits (February 25, 2026).docx
6 Mar 19:22
elaine@granola.so
Elaine Foreman sent for approval Default with Thumbtack DPA (69a8d24a44) (version 3).docx
6 Mar 19:13
elaine@granola.so
Camilla Bier sent for approval Default with Pinterest DPA
6 Mar 18:56
camilla@granola.so
Camilla Bier sent for approval Granola - Short Order Form Template with Pinterest PoC Agreement
6 Mar 18:16
camilla@granola.so
Elaine Foreman sent for approval Granola - Short Order Form Template with Pinterest PoC Agreement
6 Mar 14:27
elaine@granola.so
Elaine Foreman sent for approval Default with Pinterest DPA
6 Mar 14:24
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Customer - POC Agreement with Granola.ai Product Evaluation Agreement w- DPA (FD 2.26).docx
5 Mar 20:31
fola@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Chainguard, Granola - Enterprise Order Form 2026.docx
5 Mar 19:54
fola@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
5 Mar 19:06
camilla@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
5 Mar 19:05
camilla@granola.so
Camilla Bier sent for approval Granola - Short Order Form Template with Pinterest PoC Agreement
5 Mar 18:33
camilla@granola.so
Camilla Bier sent for approval Default with Pinterest Security Exhibit
5 Mar 18:10
camilla@granola.so
Camilla Bier sent for approval Default with Pinterest DPA
5 Mar 18:08
camilla@granola.so
Elaine Foreman sent for approval Default with Pinterest Security Exhibit
5 Mar 18:01
elaine@granola.so
Camilla Bier sent for approval Default with Pinterest Security Exhibit
5 Mar 18:01
camilla@granola.so
Elaine Foreman sent for approval Default with Pinterest Security Exhibit
5 Mar 17:57
elaine@granola.so
Camilla Bier sent for approval Default with Pinterest Security Exhibit
5 Mar 17:57
camilla@granola.so
Elaine Foreman sent for approval Default with Pinterest DPA
5 Mar 17:57
elaine@granola.so
Camilla Bier sent for approval Default with Pinterest DPA
5 Mar 17:57
camilla@granola.so
Camilla Bier sent for approval Default with Pinterest Security Exhibit
5 Mar 17:46
camilla@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Customer.io, Granola REDLINE Enterprise Order Form - CIO edits (February 25, 2026).docx
4 Mar 18:44
fola@granola.so
Elaine Foreman sent for approval Granola - Short Order Form Template with Pinterest PoC Agreement
4 Mar 18:04
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
4 Mar 17:28
camilla@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Axelera AI, Granola - Enterprise Order Form with Platform Terms Jan 2026.docx
4 Mar 17:22
fola@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Axelera AI, Granola - Enterprise Order Form with Platform Terms Jan 2026.docx
4 Mar 16:23
elaine@granola.so
Elaine Foreman sent for approval Default with Pinterest Security Exhibit
4 Mar 10:00
elaine@granola.so
Elaine Foreman sent for approval Granola - Short Order Form Template with Pinterest PoC Agreement
4 Mar 09:51
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
4 Mar 09:50
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Customer.io, Granola REDLINE Enterprise Order Form - CIO edits (February 25, 2026).docx
4 Mar 09:41
elaine@granola.so
Elaine Foreman sent for approval Customer - POC Agreement with Granola.ai Product Evaluation Agreement w- DPA (FD 2.26).docx
4 Mar 09:31
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
4 Mar 04:45
camilla@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
4 Mar 04:29
camilla@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Astronomer.io, Granola - Enterprise Order Form 2026.docx
4 Mar 03:17
fola@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Astronomer.io, Granola - Enterprise Order Form 2026.docx
3 Mar 15:45
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
3 Mar 13:26
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Chainguard, Granola - Enterprise Order Form 2026.docx
3 Mar 08:01
elaine@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola_-_Enterprise_Order_Form_-_Mozilla_Mozilla_Marks12.15.25.docx
2 Mar 23:17
camilla@granola.so
Camilla Bier sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
2 Mar 23:12
camilla@granola.so
Elaine Foreman sent for approval Default with Pinterest Security Exhibit
2 Mar 11:23
elaine@granola.so
Elaine Foreman sent for approval Default with Pinterest DPA
2 Mar 10:59
elaine@granola.so
Elaine Foreman sent for approval Default with Pinterest Security Exhibit
2 Mar 10:45
elaine@granola.so
Camilla Bier sent for approval Default with Pinterest Security Exhibit
2 Mar 10:45
camilla@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with NEA - Granola - Order Form & Terms of Service (NEA Comments 2.26.26).docx
2 Mar 10:16
elaine@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola_-_Enterprise_Order_Form_-_Mozilla_Mozilla_Marks12.15.25.docx
2 Mar 05:06
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Customer.io, Granola REDLINE Enterprise Order Form - CIO edits (February 25, 2026).docx
2 Mar 04:31
fola@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Granola - Enterprise Order Form - Deerfield - 2026.02.28.docx
1 Mar 19:48
elaine@granola.so
Nifesimi Folayinka Folarin-Coker sent for approval Enterprise Order Form with Platform Terms with Axelera AI, Granola - Enterprise Order Form with Platform Terms Jan 2026.docx
28 Feb 02:52
fola@granola.so
Elaine Foreman sent for approval Enterprise Order Form with Platform Terms with Axelera AI, Granola - Enterprise Order Form with Platform Terms Jan 2026.docx
25 Feb 12:19
elaine@granola.so"""

# ─── skip known test/demo documents ─────────────────────────────────────────
SKIP_DOCS = ['example orderform', 'legal demo', 'apple music', 'nick enterprises',
             'camilla real estates', 'open space labs', 'meesho', 'coreweave',
             'complyadvan', 'alpha sense']

TEMPLATES = [
    "Enterprise Order Form with Platform Terms",
    "Customer - POC Agreement",
    "Customer MNDA Template (3rd Party)",
    "Granola MNDA Template",
    "Granola - Short Order Form Template",
    "Default",
    "Enterprise order form",
]

MIN_TURN_SECONDS = 600  # 10 min — ignore same-timestamp parallel-approver closes

def parse_dt(s):
    s = s.strip()
    if re.match(r'\d{1,2} \w+ \d{4} \d{2}:\d{2}', s):
        return datetime.strptime(s, "%d %b %Y %H:%M")
    return datetime.strptime(s + " 2026", "%d %b %H:%M %Y")

def extract_doc(line):
    # Normalise multiple spaces
    norm = re.sub(r'\s+', ' ', line)
    for t in sorted(TEMPLATES, key=len, reverse=True):
        prefix = f" sent for approval {t} with "
        if prefix in norm:
            doc = norm.split(prefix, 1)[1].strip()
            return t, doc
    return None, None

events = []
lines = RAW.strip().split('\n')
i = 0
while i < len(lines):
    line = lines[i].strip()
    if 'sent for approval' in line and ' with ' in line:
        is_elaine = line.startswith('Elaine ')
        template, doc = extract_doc(line)
        if doc:
            # Skip test/demo docs
            doc_lower = doc.lower()
            if any(skip in doc_lower for skip in SKIP_DOCS):
                i += 1
                continue
            try:
                dt = parse_dt(lines[i+1].strip())
                # Skip events before Feb 2026
                if dt.year < 2026 or (dt.year == 2026 and dt.month < 2):
                    i += 1
                    continue
                email  = lines[i+2].strip() if i+2 < len(lines) and '@' in lines[i+2] else ''
                person = line.split(' sent for approval')[0].strip()
                events.append({'is_elaine': is_elaine, 'doc': doc, 'template': template,
                                'dt': dt, 'email': email, 'person': person})
            except:
                pass
    i += 1

# Sort chronologically; at equal timestamps put Elaine events first
events.sort(key=lambda e: (e['dt'], 0 if e['is_elaine'] else 1))

# Deduplicate: same doc + same is_elaine within 2 minutes
deduped = []
for e in events:
    if (deduped
            and deduped[-1]['doc'] == e['doc']
            and deduped[-1]['is_elaine'] == e['is_elaine']
            and abs((e['dt'] - deduped[-1]['dt']).total_seconds()) < 120):
        continue
    deduped.append(e)
events = deduped

# Group by doc
by_doc = defaultdict(list)
for e in events:
    by_doc[e['doc']].append(e)

# ─── Build turns ─────────────────────────────────────────────────────────────
# NEW model:
#   Elaine event     → turn OPENS  (doc arrived at Elaine)
#   non-Elaine event → turn CLOSES (doc left Elaine, ≥10 min after open)
#   sentBy           = last non-Elaine person seen for this doc (proxy for who
#                      handed it to Elaine)
# ─────────────────────────────────────────────────────────────────────────────

def clean_name(doc):
    doc = re.sub(r'\.docx?$|\.pdf$', '', doc, flags=re.I)
    doc = re.sub(r'__Please download.*', '', doc).strip()
    m = re.match(r'^([^,]+),\s*Granola', doc)
    if m: return m.group(1).strip()
    m = re.match(r'^Granola[\s_-]+(.+)', doc, re.I)
    if m:
        name = m.group(1).strip()
        name = re.sub(r'Enterprise Order Form.*', '', name).strip(' -_')
        name = re.sub(r'^-\s*', '', name)
        return name if name else doc
    m = re.match(r'^(.+?)\s*[+&]\s*Granola', doc)
    if m: return m.group(1).strip()
    cleaned = re.sub(r'Granola[\s_]+', '', doc).strip()
    return cleaned[:50]

contracts = []
for doc, evs in sorted(by_doc.items()):
    turns            = []
    open_turn_start  = None
    open_turn_person = None   # who opened this turn (sentBy proxy)
    last_non_elaine  = ''     # last non-Elaine person to close a turn

    for e in evs:
        if e['is_elaine']:
            # Elaine received the doc → open a new turn (if not already open)
            if open_turn_start is None:
                open_turn_start  = e['dt']
                open_turn_person = last_non_elaine  # who sent it to her
        else:
            # Non-Elaine received the doc → close the open turn
            if open_turn_start is not None:
                gap = (e['dt'] - open_turn_start).total_seconds()
                if gap >= MIN_TURN_SECONDS:          # ignore same-ts duplicates
                    days = gap / 86400
                    turns.append({
                        'sentToElaine': open_turn_start.strftime('%Y-%m-%d'),
                        'sentAt':       open_turn_start.strftime('%-d %b %H:%M'),
                        'sentBy':       open_turn_person.split()[0] if open_turn_person else '',
                        'returnedDate': e['dt'].strftime('%Y-%m-%d'),
                        'returnedAt':   e['dt'].strftime('%-d %b %H:%M'),
                        'returnedTo':   e['person'].split()[0],
                        'days':         round(days, 1),
                    })
                    open_turn_start  = None
                    open_turn_person = None
                    last_non_elaine  = e['person'].split()[0]
            else:
                # Non-Elaine with no open turn → just track them
                last_non_elaine = e['person'].split()[0]

    # Still open (Elaine has it, no response yet)
    if open_turn_start is not None:
        turns.append({
            'sentToElaine': open_turn_start.strftime('%Y-%m-%d'),
            'sentAt':       open_turn_start.strftime('%-d %b %H:%M'),
            'sentBy':       open_turn_person.split()[0] if open_turn_person else '',
            'returnedDate': None,
            'returnedAt':   None,
            'returnedTo':   None,
            'days':         None,
        })

    if turns:
        contracts.append({'name': clean_name(doc), 'doc': doc, 'turns': turns})

# Sort: most completed turns first, then most recent activity
contracts.sort(key=lambda c: -len([t for t in c['turns'] if t['returnedDate']]))

# ─── Stats ────────────────────────────────────────────────────────────────────
print(f"Total contracts : {len(contracts)}")
print(f"Total turns     : {sum(len(c['turns']) for c in contracts)}")
completed = [t for c in contracts for t in c['turns'] if t['returnedDate']]
print(f"Completed turns : {len(completed)}")
if completed:
    avg = sum(t['days'] for t in completed) / len(completed)
    print(f"Avg turnaround  : {round(avg,1)} days")

# ─── JS output ───────────────────────────────────────────────────────────────
print("\n--- CONTRACTS JS ---\n")
print("const CONTRACTS = [")
for c in contracts:
    print(f"  {{")
    print(f"    name:         {json.dumps(c['name'])},")
    print(f"    counterparty: {json.dumps(c['doc'].split(',')[0].replace('Granola','').strip()[:60])},")
    print(f"    turns: [")
    for t in c['turns']:
        rd  = json.dumps(t['returnedDate'])
        rat = json.dumps(t.get('returnedAt'))
        rto = json.dumps(t.get('returnedTo'))
        sat = json.dumps(t.get('sentAt', ''))
        sby = json.dumps(t.get('sentBy', ''))
        print(f"      {{ sentToElaine: {json.dumps(t['sentToElaine'])}, sentAt: {sat}, sentBy: {sby}, returnedDate: {rd}, returnedAt: {rat}, returnedTo: {rto} }},")
    print(f"    ],")
    print(f"  }},")
print("];")
