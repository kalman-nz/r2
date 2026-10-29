import { TabBar, useTab, type TabDef } from "./Tabs";
import MembersSettings from "./MembersSettings";
import RolesSettings from "./RolesSettings";
import { useRole } from "../lib/roles";

// Settings → Users & access: who's in the organisation (Members), and what
// each role lets them do (Roles). Each tab shows to whoever can use it:
// members with team.manage, roles with roles.manage or team.manage.
type Tab = "members" | "roles";

export default function AccessSettings() {
  const { can } = useRole();
  const tabs: TabDef<Tab>[] = [
    ...(can("team.manage") ? [{ key: "members" as const, label: "Members" }] : []),
    ...(can("roles.manage") || can("team.manage") ? [{ key: "roles" as const, label: "Roles & permissions" }] : []),
  ];
  const [tab, openTab] = useTab(tabs.length > 0 ? tabs : [{ key: "members", label: "Members" }]);
  return (
    <div className="flex flex-col gap-4">
      {tabs.length > 1 && <TabBar label="Users and access" tabs={tabs} current={tab} onOpen={openTab} />}
      {tab === "members" ? <MembersSettings /> : <RolesSettings />}
    </div>
  );
}
