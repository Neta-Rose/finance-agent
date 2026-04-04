#!/usr/bin/env python3
import bcrypt, json, os, getpass

pw = getpass.getpass("Enter dashboard password: ")
pw2 = getpass.getpass("Confirm password: ")
if pw != pw2:
    print("Passwords don't match")
    exit(1)

hashed = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
auth_file = os.path.join(os.path.dirname(__file__), "auth.json")
with open(auth_file, "w") as f:
    json.dump({"password_hash": hashed}, f)
os.chmod(auth_file, 0o600)
print("Password set successfully.")
