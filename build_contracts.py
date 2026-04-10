import subprocess, re, json

result = subprocess.run(['python3', '/tmp/parse_juro.py'], capture_output=True, text=True)
output = result.stdout
start = output.index('const CONTRACTS')
end   = output.index('];', start) + 2
raw_js = output[start:end]

# (fragment_in_name_field, display_name, contract_type)
NAME_MAP = [
    ("NEA - -",              "NEA",                  "Order Form & ToS"),
    ("PCIG Comments",        "PCIG",                 "Enterprise Order Form"),
    ("Chainguard",           "Chainguard",            "Enterprise Order Form"),
    ("Deerfield",            "Deerfield",             "Enterprise Order Form"),
    ("PandaDoc",             "PandaDoc",              "Enterprise Order Form"),
    ("Amplitude",            "Amplitude",             "Enterprise Order Form"),
    ("Citadel",              "Citadel",               "AI Pilot Agreement"),
    ("Justworks",            "Justworks",             "MSA"),
    ("Astronomer",           "Astronomer.io",         "Enterprise Order Form"),
    ("CharlesBank",          "CharlesBank",           "Enterprise Order Form"),
    ("Customer.io",          "Customer.io",           "Enterprise Order Form"),
    ("DevRev",               "DevRev",                "Order Form"),
    ("Gladly",               "Gladly",                "Platform Terms"),
    ("Mozilla",              "Mozilla",               "Enterprise Order Form"),
    ("Komodo Health",        "Komodo Health",          "MSA"),
    ("Pinterest DPA",        "Pinterest",             "DPA"),
    ("Pinterest Security",   "Pinterest",             "Security Exhibit"),
    ("Pinterest PoC",        "Pinterest",             "PoC Agreement"),
    ("9Fin",                 "9Fin",                  "Enterprise Order Form"),
    ("Axelera AI",           "Axelera AI",            "Enterprise Order Form"),
    ("Barrenjoey",           "Barrenjoey",            "Commercial MNDA"),
    ("Tatari",               "Tatari",                "Order Form"),
    ("BCV_POC",              "BCV",                   "POC Agreement"),
    ("Litera Compare",       "TA",                    "Enterprise Order Form"),
    ("M&G - MNDA",           "M&G",                   "MNDA"),
    ("Optimizely",           "Optimizely",            "Enterprise Order Form"),
    ("Posthog",              "Posthog",               "Enterprise Order Form"),
    ("TR 03-06",             "TR",                    "Contract Redline"),
    ("Thumbtack Order",      "Thumbtack",             "Order Form"),
    ("Thumbtack DPA",        "Thumbtack",             "DPA"),
    ("Airtable",             "Airtable",              "MNDA"),
    ("Docker",               "Docker",                "Order Form"),
    ("EF Order Form",        "EF Order Form",         "Short Order Form"),
    ("K1 - Redline",         "K1",                    "Enterprise Order Form"),
    ("Jan 2026 (1)",         "Enterprise Order Form (Jan 2026)", "Platform Terms"),
    ("New Imagitas",         "Red Ventures",          "Order Form"),
    ("FD 2.26",              "FD",                    "Product Eval + DPA"),
    ("BCV_MNDA",             "BCV",                   "MNDA"),
    ("ID 53162",             "Confidentiality Agreement", "Mar 2026"),
    ("PAGERDUTY",            "PagerDuty",             "MNDA"),
    ("a16z",                 "a16z",                  "Renewal"),
    ("AssemblyAI",           "AssemblyAI",            "Order Form"),
    ("MSA+OF_JWrev3",        "JW",                    "MSA + Order Form"),
    ("Harvey",               "Harvey",                "Enterprise Order Form"),
    ("MNDA Form 2020 (1)",   "MNDA Form 2020",        "MNDA (revised)"),
    ("MNDA Form 2020",       "MNDA Form 2020",        "MNDA"),
    ("G2",                   "G2",                    "Enterprise Order Form"),
    ("Checkr",               "Checkr",                "Enterprise Order Form"),
]

blocks = re.split(r'\n  \{', raw_js)[1:]

print("const CONTRACTS = [")
for block in blocks:
    nm = re.search(r'name:\s+"([^"]+)"', block)
    if not nm:
        continue
    raw_name = nm.group(1)

    display_name = raw_name
    counterparty = raw_name

    for (key, n, cpt) in NAME_MAP:
        if key.lower() in raw_name.lower():
            display_name = n
            counterparty = cpt
            break

    turns_m = re.search(r'turns: \[([\s\S]*)\s*\]', block)
    if not turns_m:
        continue

    print(f"  {{")
    print(f"    name:         {json.dumps(display_name)},")
    print(f"    counterparty: {json.dumps(counterparty)},")
    print(f"    turns: [")
    for tm in re.findall(r'\{([^}]+)\}', turns_m.group(1)):
        fields = {}
        for m in re.finditer(r'(\w+):\s*("(?:[^"\\]|\\.)*"|null)', tm):
            k, v = m.group(1), m.group(2)
            fields[k] = None if v == 'null' else v.strip('"')
        if not fields:
            continue
        print(f"      {{ sentToElaine: {json.dumps(fields.get('sentToElaine'))}, sentAt: {json.dumps(fields.get('sentAt'))}, sentBy: {json.dumps(fields.get('sentBy'))}, returnedDate: {json.dumps(fields.get('returnedDate'))}, returnedAt: {json.dumps(fields.get('returnedAt'))}, returnedTo: {json.dumps(fields.get('returnedTo'))} }},")
    print(f"    ],")
    print(f"  }},")
print("];")
