--
-- PostgreSQL database dump
--

\restrict EkUO761yHaQEwM7fRh0VjVqhDe7B1XjU3Wfl0ccUkdazwHc1nmrrb6IU5WxWEhK

-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: Role; Type: TABLE DATA; Schema: public; Owner: postgres
--

SET SESSION AUTHORIZATION DEFAULT;

ALTER TABLE public."Role" DISABLE TRIGGER ALL;

INSERT INTO public."Role" (id, name, description, "isSystem", "createdAt", "updatedAt") VALUES ('cecb5af1-c24c-4141-84b1-95f9bfce6312', 'hr', 'Human Resource Manager with access to HR and Master modules.', false, '2026-01-30 15:08:50.649', '2026-01-30 15:08:50.649');
INSERT INTO public."Role" (id, name, description, "isSystem", "createdAt", "updatedAt") VALUES ('6af8b2de-1143-4722-9d6f-85266d9277a0', 'employee', 'Standard employee with self-service access.', false, '2026-01-30 15:08:50.661', '2026-01-30 15:08:50.661');


ALTER TABLE public."Role" ENABLE TRIGGER ALL;

--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."User" DISABLE TRIGGER ALL;



ALTER TABLE public."User" ENABLE TRIGGER ALL;

--
-- Data for Name: ActivityLog; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."ActivityLog" DISABLE TRIGGER ALL;



ALTER TABLE public."ActivityLog" ENABLE TRIGGER ALL;

--
-- Data for Name: Allocation; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Allocation" DISABLE TRIGGER ALL;



ALTER TABLE public."Allocation" ENABLE TRIGGER ALL;

--
-- Data for Name: AllowanceHead; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."AllowanceHead" DISABLE TRIGGER ALL;



ALTER TABLE public."AllowanceHead" ENABLE TRIGGER ALL;

--
-- Data for Name: ApprovalSetting; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."ApprovalSetting" DISABLE TRIGGER ALL;



ALTER TABLE public."ApprovalSetting" ENABLE TRIGGER ALL;

--
-- Data for Name: Bank; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Bank" DISABLE TRIGGER ALL;



ALTER TABLE public."Bank" ENABLE TRIGGER ALL;

--
-- Data for Name: BlacklistedToken; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."BlacklistedToken" DISABLE TRIGGER ALL;



ALTER TABLE public."BlacklistedToken" ENABLE TRIGGER ALL;

--
-- Data for Name: BonusType; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."BonusType" DISABLE TRIGGER ALL;



ALTER TABLE public."BonusType" ENABLE TRIGGER ALL;

--
-- Data for Name: Country; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Country" DISABLE TRIGGER ALL;



ALTER TABLE public."Country" ENABLE TRIGGER ALL;

--
-- Data for Name: State; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."State" DISABLE TRIGGER ALL;



ALTER TABLE public."State" ENABLE TRIGGER ALL;

--
-- Data for Name: City; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."City" DISABLE TRIGGER ALL;



ALTER TABLE public."City" ENABLE TRIGGER ALL;

--
-- Data for Name: Tenant; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Tenant" DISABLE TRIGGER ALL;



ALTER TABLE public."Tenant" ENABLE TRIGGER ALL;

--
-- Data for Name: Company; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Company" DISABLE TRIGGER ALL;



ALTER TABLE public."Company" ENABLE TRIGGER ALL;

--
-- Data for Name: DeductionHead; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."DeductionHead" DISABLE TRIGGER ALL;



ALTER TABLE public."DeductionHead" ENABLE TRIGGER ALL;

--
-- Data for Name: DegreeType; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."DegreeType" DISABLE TRIGGER ALL;



ALTER TABLE public."DegreeType" ENABLE TRIGGER ALL;

--
-- Data for Name: Department; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Department" DISABLE TRIGGER ALL;



ALTER TABLE public."Department" ENABLE TRIGGER ALL;

--
-- Data for Name: Designation; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Designation" DISABLE TRIGGER ALL;



ALTER TABLE public."Designation" ENABLE TRIGGER ALL;

--
-- Data for Name: EOBI; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."EOBI" DISABLE TRIGGER ALL;



ALTER TABLE public."EOBI" ENABLE TRIGGER ALL;

--
-- Data for Name: EmployeeGrade; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."EmployeeGrade" DISABLE TRIGGER ALL;



ALTER TABLE public."EmployeeGrade" ENABLE TRIGGER ALL;

--
-- Data for Name: EmployeeStatus; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."EmployeeStatus" DISABLE TRIGGER ALL;



ALTER TABLE public."EmployeeStatus" ENABLE TRIGGER ALL;

--
-- Data for Name: Equipment; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Equipment" DISABLE TRIGGER ALL;



ALTER TABLE public."Equipment" ENABLE TRIGGER ALL;

--
-- Data for Name: FileUpload; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."FileUpload" DISABLE TRIGGER ALL;



ALTER TABLE public."FileUpload" ENABLE TRIGGER ALL;

--
-- Data for Name: Holiday; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Holiday" DISABLE TRIGGER ALL;



ALTER TABLE public."Holiday" ENABLE TRIGGER ALL;

--
-- Data for Name: Institute; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Institute" DISABLE TRIGGER ALL;



ALTER TABLE public."Institute" ENABLE TRIGGER ALL;

--
-- Data for Name: JobType; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."JobType" DISABLE TRIGGER ALL;



ALTER TABLE public."JobType" ENABLE TRIGGER ALL;

--
-- Data for Name: LeaveType; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."LeaveType" DISABLE TRIGGER ALL;



ALTER TABLE public."LeaveType" ENABLE TRIGGER ALL;

--
-- Data for Name: LeavesPolicy; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."LeavesPolicy" DISABLE TRIGGER ALL;



ALTER TABLE public."LeavesPolicy" ENABLE TRIGGER ALL;

--
-- Data for Name: LeavesPolicyLeaveType; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."LeavesPolicyLeaveType" DISABLE TRIGGER ALL;



ALTER TABLE public."LeavesPolicyLeaveType" ENABLE TRIGGER ALL;

--
-- Data for Name: LoanType; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."LoanType" DISABLE TRIGGER ALL;



ALTER TABLE public."LoanType" ENABLE TRIGGER ALL;

--
-- Data for Name: Location; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Location" DISABLE TRIGGER ALL;



ALTER TABLE public."Location" ENABLE TRIGGER ALL;

--
-- Data for Name: LoginHistory; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."LoginHistory" DISABLE TRIGGER ALL;



ALTER TABLE public."LoginHistory" ENABLE TRIGGER ALL;

--
-- Data for Name: MaritalStatus; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."MaritalStatus" DISABLE TRIGGER ALL;



ALTER TABLE public."MaritalStatus" ENABLE TRIGGER ALL;

--
-- Data for Name: Notification; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Notification" DISABLE TRIGGER ALL;



ALTER TABLE public."Notification" ENABLE TRIGGER ALL;

--
-- Data for Name: NotificationDeliveryAttempt; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."NotificationDeliveryAttempt" DISABLE TRIGGER ALL;



ALTER TABLE public."NotificationDeliveryAttempt" ENABLE TRIGGER ALL;

--
-- Data for Name: Permission; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Permission" DISABLE TRIGGER ALL;

INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('3b9a1d94-34ff-4db8-9d59-031bf60afe69', 'master.department.create', 'master.department', 'create', 'Create Department', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('f60a4e94-f92f-47d1-864d-2db3d030bdf1', 'master.department.read', 'master.department', 'read', 'Read Department', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('fe75c998-3ef5-42dd-95df-f12b644fbc27', 'master.department.update', 'master.department', 'update', 'Update Department', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('186cf258-a493-4487-93a3-b9c9ec2895d9', 'master.department.delete', 'master.department', 'delete', 'Delete Department', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('1f27c158-ebca-44d8-830e-697776da3373', 'master.sub-department.create', 'master.sub-department', 'create', 'Create SubDepartment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('aa07aeb6-fcf6-483c-bcae-5d7b5bb18789', 'master.sub-department.read', 'master.sub-department', 'read', 'Read SubDepartment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('6b63df38-5fec-4061-b104-4f7feeea3380', 'master.sub-department.update', 'master.sub-department', 'update', 'Update SubDepartment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('6de44310-868c-46d3-85c1-b5a4f4fe8a5d', 'master.sub-department.delete', 'master.sub-department', 'delete', 'Delete SubDepartment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('74ae9d94-8f2d-403d-90f8-c53b0a1f75af', 'master.institute.create', 'master.institute', 'create', 'Create Institute', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('7beb7d41-0966-41f9-b718-4240372cf411', 'master.institute.read', 'master.institute', 'read', 'Read Institute', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('8e5750da-9d98-4bcf-a319-3c3808cb28b4', 'master.institute.update', 'master.institute', 'update', 'Update Institute', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('e4ea3e1e-ec40-473a-b92d-3361cf7576a0', 'master.institute.delete', 'master.institute', 'delete', 'Delete Institute', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('275cbb9b-f069-4b0d-a961-5e21cd10f050', 'master.qualification.create', 'master.qualification', 'create', 'Create Qualification', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('5fdd8958-c8c9-475e-bec9-88e73d660ea2', 'master.qualification.read', 'master.qualification', 'read', 'Read Qualification', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('e1807139-9fb8-46ca-b54e-fa6a33d5a087', 'master.qualification.update', 'master.qualification', 'update', 'Update Qualification', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('cdbc483e-6e1d-48fc-8721-42aa1fabc218', 'master.qualification.delete', 'master.qualification', 'delete', 'Delete Qualification', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('bcf204f2-1fc2-4a4d-bf84-36b6ab9f17ad', 'master.designation.create', 'master.designation', 'create', 'Create Designation', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('dd8b713e-94af-45fb-bf62-867fc539fe7e', 'master.designation.read', 'master.designation', 'read', 'Read Designation', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('7eb6a9d6-e242-496b-b99b-dd812069c12e', 'master.designation.update', 'master.designation', 'update', 'Update Designation', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('c716b28d-562c-478d-907e-25b2699037c8', 'master.designation.delete', 'master.designation', 'delete', 'Delete Designation', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('d2dd213c-ff3b-4cf6-8f42-a07d41c93531', 'master.location.create', 'master.location', 'create', 'Create Location', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('ee05994d-3c3e-4ae7-9ff4-0007dc364b59', 'master.location.read', 'master.location', 'read', 'Read Location', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('d18e35a5-8bd7-48d3-8e9f-715c76b9481a', 'master.location.update', 'master.location', 'update', 'Update Location', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('27709b2f-f01b-4def-91db-844a1a44b0ac', 'master.location.delete', 'master.location', 'delete', 'Delete Location', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('9f1c84e3-bc6b-49aa-b7df-dbbbeb7dad82', 'master.job-type.create', 'master.job-type', 'create', 'Create Job Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('cf5f998e-41a1-4555-81be-5c3228cd25e7', 'master.job-type.read', 'master.job-type', 'read', 'Read Job Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('6c0fb6f1-6793-4a93-bbfc-deaacd04111c', 'master.job-type.update', 'master.job-type', 'update', 'Update Job Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('501ada59-170f-40a8-8404-472756f887ac', 'master.job-type.delete', 'master.job-type', 'delete', 'Delete Job Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('a6ffe275-c6d9-4578-951c-74fb6880fe9d', 'master.marital-status.create', 'master.marital-status', 'create', 'Create Marital Status', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('c38ecaa0-9d6a-4bab-9ba2-7064816da642', 'master.marital-status.read', 'master.marital-status', 'read', 'Read Marital Status', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('41782778-e46f-4eec-9efe-ec19367acbb8', 'master.marital-status.update', 'master.marital-status', 'update', 'Update Marital Status', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('839ad7a7-1042-4218-9f91-4086368e18ec', 'master.marital-status.delete', 'master.marital-status', 'delete', 'Delete Marital Status', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('de3e75cd-fddf-4bbc-8c98-3f22c531cf76', 'master.employee-grade.create', 'master.employee-grade', 'create', 'Create Employee Grade', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('ffdd9a5e-d0dd-4442-aef4-4c7d6fdbf30b', 'master.employee-grade.read', 'master.employee-grade', 'read', 'Read Employee Grade', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('3469dcdc-1d08-499e-9898-edf778110779', 'master.employee-grade.update', 'master.employee-grade', 'update', 'Update Employee Grade', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('5c2753e1-67e6-46fa-ad94-820a99fd8b56', 'master.employee-grade.delete', 'master.employee-grade', 'delete', 'Delete Employee Grade', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('2df37dcb-52f7-46b4-9ad5-d2e68ab20b6e', 'master.employee-status.create', 'master.employee-status', 'create', 'Create Employment Status', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('7d03ee71-6d99-4ba0-b80e-daf71196da12', 'master.employee-status.read', 'master.employee-status', 'read', 'Read Employment Status', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('1becf00b-00ad-4650-bf6c-bb81853bf38a', 'master.employee-status.update', 'master.employee-status', 'update', 'Update Employment Status', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('3d2cac62-c9fe-42c6-ab43-b2118bfb7b3e', 'master.employee-status.delete', 'master.employee-status', 'delete', 'Delete Employment Status', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('3a76681b-c528-46b8-aa90-2b8dfd18bc7f', 'master.city.create', 'master.city', 'create', 'Create City', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('b356e7d1-f35a-44b1-998a-fe2984f55c80', 'master.city.read', 'master.city', 'read', 'Read City', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('6f32f13c-93ac-4902-984d-557b4cecd48d', 'master.city.update', 'master.city', 'update', 'Update City', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('39035505-7ae7-4395-83c0-38fcc96b33e3', 'master.city.delete', 'master.city', 'delete', 'Delete City', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('27991925-c444-446d-8a3f-c1d481c962ea', 'master.allocation.create', 'master.allocation', 'create', 'Create Allocation', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('4808834f-ed17-4dea-89d8-88b96ee2320d', 'master.allocation.read', 'master.allocation', 'read', 'Read Allocation', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('0e92dabf-d924-4ace-90bf-9edd548d3933', 'master.allocation.update', 'master.allocation', 'update', 'Update Allocation', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('5cc3f1e2-0585-4562-9c13-5c0d82661edb', 'master.allocation.delete', 'master.allocation', 'delete', 'Delete Allocation', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('d8f558b0-33a3-4f4d-b267-a488be211a2a', 'master.loan-type.create', 'master.loan-type', 'create', 'Create Loan Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('45f7728a-3468-4d29-9f44-45306877770e', 'master.loan-type.read', 'master.loan-type', 'read', 'Read Loan Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('334cde45-462b-4a0d-a815-969b62ce98fe', 'master.loan-type.update', 'master.loan-type', 'update', 'Update Loan Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('c6621ceb-532d-4945-a7e5-77049cea9618', 'master.loan-type.delete', 'master.loan-type', 'delete', 'Delete Loan Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('9d5d4d4e-8db0-4fb4-9b89-e30e6cf2b2ca', 'master.leave-type.create', 'master.leave-type', 'create', 'Create Leave Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('f4df94bb-a195-47b7-ae67-8eb7b875e11c', 'master.leave-type.read', 'master.leave-type', 'read', 'Read Leave Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('45378c1c-91ec-4b5f-a2f4-6076e35d6530', 'master.leave-type.update', 'master.leave-type', 'update', 'Update Leave Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('05cb9b58-c1ce-4194-a184-4d118637a8f4', 'master.leave-type.delete', 'master.leave-type', 'delete', 'Delete Leave Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('1a0a3a49-7f81-486e-8972-862b421b84f5', 'master.leaves-policy.create', 'master.leaves-policy', 'create', 'Create Leaves Policy', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('7ece4e0b-8504-4dd9-9e72-f62cd5c1415a', 'master.leaves-policy.read', 'master.leaves-policy', 'read', 'Read Leaves Policy', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('4d26518c-9674-44ee-b267-0238f0d660ac', 'master.leaves-policy.update', 'master.leaves-policy', 'update', 'Update Leaves Policy', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('33529f02-05cd-479f-bb8a-34f790663b1c', 'master.leaves-policy.delete', 'master.leaves-policy', 'delete', 'Delete Leaves Policy', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('e95290dc-2ba2-4deb-a1b4-461ed70fa173', 'master.equipment.create', 'master.equipment', 'create', 'Create Equipment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('b9988168-26c4-4a8f-a57c-85a4aef8d733', 'master.equipment.read', 'master.equipment', 'read', 'Read Equipment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('48d92bfd-7502-46fc-b0d8-8ec2c5c46074', 'master.equipment.update', 'master.equipment', 'update', 'Update Equipment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('6e41e6dc-7f35-4a3a-9ec7-0ad3c22387ef', 'master.equipment.delete', 'master.equipment', 'delete', 'Delete Equipment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('d619c3fa-b136-4322-a2ce-277431da31f5', 'master.salary-breakup.create', 'master.salary-breakup', 'create', 'Create Salary Breakup', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('1d8b2cc7-9804-44fe-94c9-cf6d9616419a', 'master.salary-breakup.read', 'master.salary-breakup', 'read', 'Read Salary Breakup', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('9a1c7adc-d13a-4ab3-8ed4-bbe9c87d2b91', 'master.salary-breakup.update', 'master.salary-breakup', 'update', 'Update Salary Breakup', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('bb866211-6766-4e83-9463-1af4cb87654d', 'master.salary-breakup.delete', 'master.salary-breakup', 'delete', 'Delete Salary Breakup', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('f3fa23aa-9654-41d1-a63b-28a3bd5dd38c', 'master.eobi.create', 'master.eobi', 'create', 'Create EOBI', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('dca4b2ae-75ff-4218-900c-acfbf783c2db', 'master.eobi.read', 'master.eobi', 'read', 'Read EOBI', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('0e2a19f0-12fc-4cdc-b208-13e388a7e57b', 'master.eobi.update', 'master.eobi', 'update', 'Update EOBI', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('abce26f8-f65c-40c5-85e3-8fc6be83f390', 'master.eobi.delete', 'master.eobi', 'delete', 'Delete EOBI', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('6576ce8c-a4a5-4c67-b804-848730a82cc7', 'master.social-security.create', 'master.social-security', 'create', 'Create Social Security', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('648a33d6-a19e-458c-a739-00bc0b015b6f', 'master.social-security.read', 'master.social-security', 'read', 'Read Social Security', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('6b9166f7-2572-4f84-ba19-71529dda4b57', 'master.social-security.update', 'master.social-security', 'update', 'Update Social Security', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('47bf2f42-312f-4087-9d74-bdccc9c4fe3c', 'master.social-security.delete', 'master.social-security', 'delete', 'Delete Social Security', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('5d341793-01f8-4dac-a691-25cfdee89959', 'master.tax-slab.create', 'master.tax-slab', 'create', 'Create Tax Slab', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('0009a96d-509c-4b2a-93b5-3b037e87e01e', 'master.tax-slab.read', 'master.tax-slab', 'read', 'Read Tax Slab', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('85b6cf31-74f9-4abb-98c8-ca4441825bf7', 'master.tax-slab.update', 'master.tax-slab', 'update', 'Update Tax Slab', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('8e09758b-6315-4628-b696-75edcc4fae4e', 'master.tax-slab.delete', 'master.tax-slab', 'delete', 'Delete Tax Slab', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('e420e462-8bad-48fe-8ff0-254e30864c38', 'master.provident-fund.create', 'master.provident-fund', 'create', 'Create Provident Fund', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('5f310cb4-1ad1-472a-8d1a-ec09626df0b0', 'master.provident-fund.read', 'master.provident-fund', 'read', 'Read Provident Fund', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('dd6b1be6-c882-4247-8c5d-a26577353a56', 'master.provident-fund.update', 'master.provident-fund', 'update', 'Update Provident Fund', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('e23084a0-8b46-4bca-b5d1-da4b4a241e4e', 'master.provident-fund.delete', 'master.provident-fund', 'delete', 'Delete Provident Fund', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('2f65a58a-cfaa-42dc-9965-e6139ee1d20e', 'master.bonus-type.create', 'master.bonus-type', 'create', 'Create Bonus Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('db9fc94c-f686-4e39-8f39-876bb0c8856c', 'master.bonus-type.read', 'master.bonus-type', 'read', 'Read Bonus Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('3162c65c-d44d-4d11-8821-c0ca452d8255', 'master.bonus-type.update', 'master.bonus-type', 'update', 'Update Bonus Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('9e5b9beb-cac5-493c-b2ce-78546b3dd42f', 'master.bonus-type.delete', 'master.bonus-type', 'delete', 'Delete Bonus Type', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('48d6e349-8330-47cc-9a23-2285cb35379d', 'master.allowance-head.create', 'master.allowance-head', 'create', 'Create Allowance Head', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('6b248420-bcb5-4517-9764-51e3729f4bde', 'master.allowance-head.read', 'master.allowance-head', 'read', 'Read Allowance Head', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('99ceea69-be1c-4401-889a-fabb666a1727', 'master.allowance-head.update', 'master.allowance-head', 'update', 'Update Allowance Head', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('4bf69ff1-e94c-49ad-92b2-61331e0c3e11', 'master.allowance-head.delete', 'master.allowance-head', 'delete', 'Delete Allowance Head', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('9e8d3f7a-e59e-4bcd-a6ee-c3bd0c9c86f9', 'master.deduction-head.create', 'master.deduction-head', 'create', 'Create Deduction Head', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('66e36809-494d-4941-b742-103a17d7bfd7', 'master.deduction-head.read', 'master.deduction-head', 'read', 'Read Deduction Head', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('4cd7f8e0-ff4b-4286-9b56-1f7f65dafc68', 'master.deduction-head.update', 'master.deduction-head', 'update', 'Update Deduction Head', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('f79802e7-7015-45ad-820d-613502b2b675', 'master.deduction-head.delete', 'master.deduction-head', 'delete', 'Delete Deduction Head', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('2574ca0c-8316-43af-9aad-ea7625d76f78', 'master.bank.create', 'master.bank', 'create', 'Create Bank', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('9c87ff9e-b440-4cee-bbbf-72b9e03938b6', 'master.bank.read', 'master.bank', 'read', 'Read Bank', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('b215adb4-fd6a-4ad2-ae77-c79007b32780', 'master.bank.update', 'master.bank', 'update', 'Update Bank', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('c6c11604-a2ad-4c33-8784-ee0ec9806ca6', 'master.bank.delete', 'master.bank', 'delete', 'Delete Bank', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('830b4e2c-e420-4897-ae8c-ea43b210e530', 'hr.dashboard.view', 'hr.dashboard', 'view', 'View HR Dashboard', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('7b6e4645-e291-40de-86bc-0973f23729e9', 'hr.employee.create', 'hr.employee', 'create', 'Create Employee', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('1ab5c491-c1ba-4234-ae24-b2e0c7625b80', 'hr.employee.read', 'hr.employee', 'read', 'Read Employee', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('f7718b82-24d7-4c95-880e-34e00fc30d7b', 'hr.employee.transfer', 'hr.employee', 'transfer', 'Transfer Employee', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('dadbcf9d-7065-4a06-8ff4-f654663c3ce0', 'hr.employee.user-account', 'hr.employee', 'user-account', 'User Account', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('c9dc0feb-5ee9-414c-a116-3518c328c5e0', 'hr.employee.update', 'hr.employee', 'update', 'Update Employee', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('04288ba9-ace6-4771-89ad-7fc563aa9ff7', 'hr.employee.delete', 'hr.employee', 'delete', 'Delete Employee', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('2ebee302-24f8-4b68-94ef-586ff2fce445', 'hr.exit-clearance.create', 'hr.exit-clearance', 'create', 'Exit Clearance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('1a12afca-2c14-4718-9b43-098a7066f16a', 'hr.exit-clearance.read', 'hr.exit-clearance', 'read', 'Read Exit Clearance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('c640d839-616f-4c82-84c1-6b84d57f053c', 'hr.exit-clearance.update', 'hr.exit-clearance', 'update', 'Update Exit Clearance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('5e9a79f1-1935-43cc-9717-fff2f642290f', 'hr.exit-clearance.delete', 'hr.exit-clearance', 'delete', 'Delete Exit Clearance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('32b97d39-92c8-4756-830d-a8e7922d70ff', 'hr.attendance.view', 'hr.attendance', 'view', 'View Attendance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('2cdd26a5-48cd-4f10-9c7f-87cbe2a706cf', 'hr.attendance.create', 'hr.attendance', 'create', 'Create Attendance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('32da6257-0f2b-47bf-869d-f008d6d8e3f9', 'hr.attendance.update', 'hr.attendance', 'update', 'Update Attendance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('808b34d8-9627-4084-8a1b-0056a08aba49', 'hr.attendance.delete', 'hr.attendance', 'delete', 'Delete Attendance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('874bc2f8-528b-416b-82be-75a8b8debf9f', 'hr.attendance.summary', 'hr.attendance', 'summary', 'Attendance Summary', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('4de89679-7b80-4253-8a61-89d926c62e61', 'hr.attendance.request', 'hr.attendance', 'request', 'Attendance Request', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('51f87d39-0130-48b4-b30a-44c0cb88f4a5', 'hr.attendance.request-list', 'hr.attendance', 'request-list', 'Attendance Request List', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('5da0f6ab-6917-4b25-ab19-383a63eb31a4', 'hr.attendance.exemptions', 'hr.attendance', 'exemptions', 'Attendance Exemptions', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('054205bb-e304-49a6-8676-f5411b52aef4', 'hr.attendance.exemptions-list', 'hr.attendance', 'exemptions-list', 'Attendance Exemptions List', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('bcf038ea-a450-4e22-abbf-8c8d3a07e223', 'hr.working-hour-policy.create', 'hr.working-hour-policy', 'create', 'Create Working Hour Policy', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('6ed7baa7-8335-4398-a6b7-7fb07a924c41', 'hr.working-hour-policy.read', 'hr.working-hour-policy', 'read', 'Read Working Hour Policy', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('bc926b96-6fee-429d-af71-e3a70cdf4fdb', 'hr.working-hour-policy.update', 'hr.working-hour-policy', 'update', 'Update Working Hour Policy', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('612e6f08-9253-45b1-b320-24ad53469be2', 'hr.working-hour-policy.delete', 'hr.working-hour-policy', 'delete', 'Delete Working Hour Policy', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('d6f063f9-bedb-4ef5-9ac0-0b2ce0ca5ae7', 'hr.working-hour-policy.assign', 'hr.working-hour-policy', 'assign', 'Assign Working Hour Policy', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('8b7e6cbf-8250-49c8-8c28-584b7f170ff9', 'hr.working-hour-policy.assign-list', 'hr.working-hour-policy', 'assign-list', 'Assign Working Hour Policy List', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('bc4b9002-b027-4b88-9ad2-0779abab6773', 'hr.holiday.create', 'hr.holiday', 'create', 'Create Holiday', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('d25f463a-446d-458a-9a52-d4df47c67fca', 'hr.holiday.read', 'hr.holiday', 'read', 'Read Holiday', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('59fc27f6-cb80-4a8a-ad1b-a6ea5358f38c', 'hr.holiday.update', 'hr.holiday', 'update', 'Update Holiday', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('98479205-bc62-4cd9-80b3-f6870d0b8b8e', 'hr.holiday.delete', 'hr.holiday', 'delete', 'Delete Holiday', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('2930dfd5-39ee-447a-a135-5f56f21a72a4', 'hr.leave.create', 'hr.leave', 'create', 'Create Leave', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('d7d393f3-7674-4b0b-bef0-99f80c06fa63', 'hr.leave.read', 'hr.leave', 'read', 'Read Leave', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('7200f76c-f669-474f-a71e-bfc71763b480', 'hr.leave.update', 'hr.leave', 'update', 'Update Leave', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('b9235ea7-41ff-4e88-a5d6-9e6382765b94', 'hr.leave.delete', 'hr.leave', 'delete', 'Delete Leave', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('91a92b66-8977-44d1-bfe5-18a1d055eb61', 'hr.loan-request.read', 'hr.loan-request', 'read', 'Read Loan Request', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('e6231d4d-098e-45b1-832a-383a2a97a51a', 'hr.loan-request.create', 'hr.loan-request', 'create', 'Create Loan Request', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('0cd5bed3-aabc-4f15-a4af-ee248e06b55a', 'hr.loan-request.update', 'hr.loan-request', 'update', 'Update Loan Request', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('44b8ad34-dd51-4b2b-8ba5-58dfe7f24c5c', 'hr.loan-request.delete', 'hr.loan-request', 'delete', 'Delete Loan Request', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('8b408f11-d070-4c75-a812-6b3404d96a63', 'hr.loan-request.approve', 'hr.loan-request', 'approve', 'Approve Loan Request', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('a150d944-41c6-46d0-8cf9-21d66bf63f58', 'hr.leave-encashment.read', 'hr.leave-encashment', 'read', 'Read Leave Encashment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('bac03d27-044d-47f7-bb3c-ded0668c924f', 'hr.leave-encashment.create', 'hr.leave-encashment', 'create', 'Create Leave Encashment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('f67c7c54-0a27-4c28-a142-9779ce05980e', 'hr.leave-encashment.update', 'hr.leave-encashment', 'update', 'Update Leave Encashment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('db45d199-25e6-4128-acf0-ac4087dc19a2', 'hr.leave-encashment.delete', 'hr.leave-encashment', 'delete', 'Delete Leave Encashment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('cb36cc6a-8893-447e-9ed5-be3020945e04', 'hr.leave-encashment.approve', 'hr.leave-encashment', 'approve', 'Approve Leave Encashment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('b496a392-7e4f-41b0-b951-7dc319452b54', 'hr.attendance-request-query.read', 'hr.attendance-request-query', 'read', 'Read Attendance Request Query', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('0bc61d2a-f4b0-48a2-b420-fbf4831a4949', 'hr.attendance-request-query.create', 'hr.attendance-request-query', 'create', 'Create Attendance Request Query', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('852ecd73-d2ba-4030-a389-6f97452881c3', 'hr.attendance-request-query.update', 'hr.attendance-request-query', 'update', 'Update Attendance Request Query', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('7e8989ab-10dd-4507-838f-39e12df42b8b', 'hr.attendance-request-query.delete', 'hr.attendance-request-query', 'delete', 'Delete Attendance Request Query', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('007d31d0-11c4-47e0-807c-99267fe46971', 'hr.attendance-request-query.approve', 'hr.attendance-request-query', 'approve', 'Approve Attendance Request Query', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('913673a1-c299-4df4-9806-7c40b04e724c', 'hr.advance-salary.read', 'hr.advance-salary', 'read', 'Read Advance Salary', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('807d7d50-ea03-4074-bc79-8ebb298b66c0', 'hr.advance-salary.create', 'hr.advance-salary', 'create', 'Create Advance Salary', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('73c9cab5-96df-43d3-8f05-973de7c83f5b', 'hr.advance-salary.update', 'hr.advance-salary', 'update', 'Update Advance Salary', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('073fa9ea-92a6-4e71-9b31-e0d61d422eb9', 'hr.advance-salary.delete', 'hr.advance-salary', 'delete', 'Delete Advance Salary', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('a4fbe2de-63df-490c-9993-feb4b17ea94c', 'hr.advance-salary.approve', 'hr.advance-salary', 'approve', 'Approve Advance Salary', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('362e0943-ba6f-4139-8c11-afa5630aaae8', 'hr.request-forwarding.view', 'hr.request-forwarding', 'view', 'View Request Forwarding', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('c198a522-847e-48d3-89fe-2c2e7d989bc9', 'hr.request-forwarding.manage', 'hr.request-forwarding', 'manage', 'Manage Request Forwarding', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('079bc365-b769-4942-923d-04adefde7531', 'hr.request-forwarding.attendance', 'hr.request-forwarding', 'attendance', 'Request Forwarding Attendance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('ae614ce6-a9d7-4d06-af42-7546cea3f56e', 'hr.request-forwarding.advance-salary', 'hr.request-forwarding', 'advance-salary', 'Request Forwarding Advance Salary', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('47eb915a-0ffc-4a6a-9e8e-4137dbda9f30', 'hr.request-forwarding.loan', 'hr.request-forwarding', 'loan', 'Request Forwarding Loan', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('5396d5c2-8090-43a3-82bc-eb02f418d16a', 'hr.request-forwarding.leave-application', 'hr.request-forwarding', 'leave-application', 'Request Forwarding Leave Application', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('b6166efa-8eee-4074-b681-0daa0eb1049b', 'hr.request-forwarding.leave-encashment', 'hr.request-forwarding', 'leave-encashment', 'Request Forwarding Leave Encashment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('99c8dc4d-80bf-4e86-8bd5-30e4aa21f436', 'hr.payroll.read', 'hr.payroll', 'read', 'Read Payroll', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('dfcd1056-cd66-4877-994c-ca8aa213413e', 'hr.payroll.create', 'hr.payroll', 'create', 'Create Payroll', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('6d70b24a-47dd-41fe-a229-b42107ee0681', 'hr.payroll.update', 'hr.payroll', 'update', 'Update Payroll', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('049571e5-139d-4fa0-b388-9dae077d9f33', 'hr.payroll.delete', 'hr.payroll', 'delete', 'Delete Payroll', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('5b828060-14da-4da8-80b3-dbcd56534651', 'hr.increment.read', 'hr.increment', 'read', 'Read Increment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('b3ffdda2-c8fd-4bfc-92db-30eae6bcd58d', 'hr.increment.create', 'hr.increment', 'create', 'Create Increment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('e01e4479-deaa-4f8b-9ff9-00868023ce4b', 'hr.increment.update', 'hr.increment', 'update', 'Update Increment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('63ea7f1a-3a24-4e6c-bf2d-cbdc69522659', 'hr.increment.delete', 'hr.increment', 'delete', 'Delete Increment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('610c3d36-460b-4d63-8538-500334c72454', 'hr.increment.approve', 'hr.increment', 'approve', 'Approve Increment', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('a471f258-bf5c-49c6-8d2d-58dfd7953698', 'hr.bonus.read', 'hr.bonus', 'read', 'Read Bonus', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('b924fae6-b6ff-48f4-ae61-031ef90da321', 'hr.bonus.create', 'hr.bonus', 'create', 'Create Bonus', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('d618e04f-892d-4703-a4d1-702180dbd708', 'hr.bonus.update', 'hr.bonus', 'update', 'Update Bonus', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('22d866f1-a937-4661-b0fd-9ba1b2a12c19', 'hr.bonus.delete', 'hr.bonus', 'delete', 'Delete Bonus', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('29a03f13-a28c-4e59-af0b-97aad5884d61', 'hr.bonus.approve', 'hr.bonus', 'approve', 'Approve Bonus', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('2e5ebb00-7eab-426a-86f9-f536312d8b34', 'hr.salary-sheet.read', 'hr.salary-sheet', 'read', 'Read Salary Sheet', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('3ebbae38-6dd7-43b2-b1e8-e2e71d40d374', 'hr.salary-sheet.create', 'hr.salary-sheet', 'create', 'Create Salary Sheet', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('78f567a6-502d-4a5f-ba29-b97426430f19', 'hr.salary-sheet.update', 'hr.salary-sheet', 'update', 'Update Salary Sheet', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('27891776-9886-45c4-ba74-54e57c1d116d', 'hr.salary-sheet.delete', 'hr.salary-sheet', 'delete', 'Delete Salary Sheet', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('86fe5d77-0b09-4aee-98ef-93d575c38dbd', 'hr.allowance.read', 'hr.allowance', 'read', 'Read Allowance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('b00fa3cf-7acc-4c4d-9860-dfd1273bb461', 'hr.allowance.create', 'hr.allowance', 'create', 'Create Allowance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('e337d856-bf6d-4c02-ac06-ce1e877de653', 'hr.allowance.update', 'hr.allowance', 'update', 'Update Allowance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('0300addd-de3d-4107-999c-272500eee293', 'hr.allowance.delete', 'hr.allowance', 'delete', 'Delete Allowance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('541975b3-8744-427b-b0e2-47092e5caa2c', 'hr.allowance.approve', 'hr.allowance', 'approve', 'Approve Allowance', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('6c3c239d-f0e9-418a-859e-534e8a329ec5', 'hr.deduction.read', 'hr.deduction', 'read', 'Read Deduction', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('0a13c863-cd59-40a6-967a-428a741000f9', 'hr.deduction.create', 'hr.deduction', 'create', 'Create Deduction', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('726ba0b9-bc7b-44ce-af75-8cccc423a538', 'hr.deduction.update', 'hr.deduction', 'update', 'Update Deduction', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('c700d4e7-7aa1-4aed-9376-ef149c886c9b', 'hr.deduction.delete', 'hr.deduction', 'delete', 'Delete Deduction', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('e5d5efd4-22df-4fb1-a2c2-a7b140505b94', 'hr.deduction.approve', 'hr.deduction', 'approve', 'Approve Deduction', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('1f4dde51-0199-4ad4-aa40-6690b4ebbdfb', 'hr.provident-fund.read', 'hr.provident-fund', 'read', 'Read Employee Provident Fund', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('80465de4-9076-4ef4-a6c8-8c5ba9641d98', 'hr.provident-fund.create', 'hr.provident-fund', 'create', 'Create Employee Provident Fund', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('f9c42ba5-c956-424d-8fc6-d8502e4bab6c', 'hr.provident-fund.update', 'hr.provident-fund', 'update', 'Update Employee Provident Fund', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('55a64362-9aa5-45b3-b657-e5679b9f16a7', 'hr.provident-fund.delete', 'hr.provident-fund', 'delete', 'Delete Employee Provident Fund', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('f0ee4db2-0b7c-4838-9ea5-1918187f6c21', 'hr.rebate.read', 'hr.rebate', 'read', 'Read Rebate', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('4092051c-496f-4c28-9058-be7bb74f146b', 'hr.rebate.create', 'hr.rebate', 'create', 'Create Rebate', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('b9c0292c-b4fb-4544-a47e-c1e9dc83ff0b', 'hr.rebate.update', 'hr.rebate', 'update', 'Update Rebate', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('ace140aa-571a-4b62-9aa1-264397bbaeab', 'hr.rebate.delete', 'hr.rebate', 'delete', 'Delete Rebate', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('fc288acf-9df8-4f0d-86e0-10c8971ffe80', 'hr.rebate-nature.read', 'hr.rebate-nature', 'read', 'Read Rebate Nature', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('54cb7933-87c3-452e-bdde-3801bd2dd861', 'hr.rebate-nature.create', 'hr.rebate-nature', 'create', 'Create Rebate Nature', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('91d69536-e70e-47bf-a7c3-c692e59880bb', 'hr.rebate-nature.update', 'hr.rebate-nature', 'update', 'Update Rebate Nature', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('0f2ea9e4-c845-400e-bcb9-fe3039a4cf2c', 'hr.rebate-nature.delete', 'hr.rebate-nature', 'delete', 'Delete Rebate Nature', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('b0e248d1-e07a-4fca-9e8f-11c2dd5e8565', 'hr.social-security.read', 'hr.social-security', 'read', 'Read Employee Social Security', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('945e0759-607e-4472-862d-bf24d916e2e2', 'hr.social-security.create', 'hr.social-security', 'create', 'Create Employee Social Security', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('ffdd35ef-5a45-4821-b2bf-3a3ba1fa79d3', 'hr.social-security.update', 'hr.social-security', 'update', 'Update Employee Social Security', '2026-01-30 15:00:45.46');
INSERT INTO public."Permission" (id, name, module, action, description, "createdAt") VALUES ('34fabee5-c798-4f0a-8e60-c11278fb677a', 'hr.social-security.delete', 'hr.social-security', 'delete', 'Delete Employee Social Security', '2026-01-30 15:00:45.46');


ALTER TABLE public."Permission" ENABLE TRIGGER ALL;

--
-- Data for Name: ProvidentFund; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."ProvidentFund" DISABLE TRIGGER ALL;



ALTER TABLE public."ProvidentFund" ENABLE TRIGGER ALL;

--
-- Data for Name: Qualification; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Qualification" DISABLE TRIGGER ALL;



ALTER TABLE public."Qualification" ENABLE TRIGGER ALL;

--
-- Data for Name: RebateNature; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."RebateNature" DISABLE TRIGGER ALL;



ALTER TABLE public."RebateNature" ENABLE TRIGGER ALL;

--
-- Data for Name: RefreshToken; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."RefreshToken" DISABLE TRIGGER ALL;



ALTER TABLE public."RefreshToken" ENABLE TRIGGER ALL;

--
-- Data for Name: RolePermission; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."RolePermission" DISABLE TRIGGER ALL;

INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('5eebbcb2-7004-4861-9462-3bc12de79d9b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '3b9a1d94-34ff-4db8-9d59-031bf60afe69');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('2357b3cf-34f0-4e41-8a90-0830ac34a9ed', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'f60a4e94-f92f-47d1-864d-2db3d030bdf1');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('fd589af5-4c1d-47d2-8241-a7cac9c831d3', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'fe75c998-3ef5-42dd-95df-f12b644fbc27');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('1b530769-57e1-4866-9837-7bb7d33f8d26', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '186cf258-a493-4487-93a3-b9c9ec2895d9');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('6c20b45c-bfa8-4961-8e7c-c3b59ad90908', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '1f27c158-ebca-44d8-830e-697776da3373');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('de64e744-a7f4-4d0c-85a4-109ab33597b1', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'aa07aeb6-fcf6-483c-bcae-5d7b5bb18789');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('2151410a-db07-4a61-8517-8b57ae3f6c55', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '6b63df38-5fec-4061-b104-4f7feeea3380');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('ded297c4-1e59-41bc-9e38-be91847d811c', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '6de44310-868c-46d3-85c1-b5a4f4fe8a5d');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('146cc983-cdfd-406b-a3fd-0c00d2386935', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '74ae9d94-8f2d-403d-90f8-c53b0a1f75af');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('b65409da-a206-4f1b-949b-f06a3b4f0cb0', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '7beb7d41-0966-41f9-b718-4240372cf411');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('1930bf52-4bc0-4096-8e92-d99d2f44c978', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '8e5750da-9d98-4bcf-a319-3c3808cb28b4');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('ddf0d84d-6af5-477b-b0e3-ff5bf821e1e8', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'e4ea3e1e-ec40-473a-b92d-3361cf7576a0');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('7003032e-0d89-40bf-b272-c68a40f0a6f2', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '275cbb9b-f069-4b0d-a961-5e21cd10f050');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('f25af413-3ace-47e5-903b-d00218ed5e77', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '5fdd8958-c8c9-475e-bec9-88e73d660ea2');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('bb41c1d0-2801-4d50-acfd-254df8af3957', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'e1807139-9fb8-46ca-b54e-fa6a33d5a087');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('763d9e46-48e4-4b6c-b6e8-46d43d73abef', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'cdbc483e-6e1d-48fc-8721-42aa1fabc218');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('70442371-c3fa-44f4-8cd2-91c423136748', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'bcf204f2-1fc2-4a4d-bf84-36b6ab9f17ad');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('57145c5d-2a07-4573-bbdd-545cc0175b19', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'dd8b713e-94af-45fb-bf62-867fc539fe7e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('df8472bc-e791-4f07-8257-667cbf49cea7', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '7eb6a9d6-e242-496b-b99b-dd812069c12e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('6a982176-c7ea-45ca-b052-6589588ab1d6', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'c716b28d-562c-478d-907e-25b2699037c8');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('e4d1d3b7-1927-49f0-a705-013f900828ae', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'd2dd213c-ff3b-4cf6-8f42-a07d41c93531');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('7b5b4faf-1360-4089-9545-f5a078f2bff0', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'ee05994d-3c3e-4ae7-9ff4-0007dc364b59');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('d1b10e64-fda6-4ffc-b56b-dedcec05fd71', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'd18e35a5-8bd7-48d3-8e9f-715c76b9481a');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('92e3e4a1-cdbe-4916-a9ff-522afa600a9c', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '27709b2f-f01b-4def-91db-844a1a44b0ac');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('aac41bf7-fdba-45bd-9e55-7a62d995058a', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '9f1c84e3-bc6b-49aa-b7df-dbbbeb7dad82');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('912c615b-f071-40fa-95bd-821881d685fd', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'cf5f998e-41a1-4555-81be-5c3228cd25e7');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('348b5e14-0483-4047-be6c-c4863115b6e4', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '6c0fb6f1-6793-4a93-bbfc-deaacd04111c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('484bbaaf-d5d1-4d07-aa3e-e369faf46d72', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '501ada59-170f-40a8-8404-472756f887ac');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('278838e2-5a20-464d-9577-de3c52955c5b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'a6ffe275-c6d9-4578-951c-74fb6880fe9d');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('646c39a7-08b2-483c-9682-e6ccefdda689', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'c38ecaa0-9d6a-4bab-9ba2-7064816da642');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('26583259-5b21-4046-890a-deccfc899c1a', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '41782778-e46f-4eec-9efe-ec19367acbb8');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('d2cf344e-83df-4cd0-af2d-24897aabf475', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '839ad7a7-1042-4218-9f91-4086368e18ec');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('8a7228fa-c3bc-4012-a56b-de719af009ef', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'de3e75cd-fddf-4bbc-8c98-3f22c531cf76');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('ed08bf5b-273a-472d-bb5b-3ba139f66bcb', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'ffdd9a5e-d0dd-4442-aef4-4c7d6fdbf30b');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('6d06c12c-e280-41e1-bb08-913f80f9b423', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '3469dcdc-1d08-499e-9898-edf778110779');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('5563df30-9b7a-471f-8dd5-3c7fcdcb3e1b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '5c2753e1-67e6-46fa-ad94-820a99fd8b56');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('48d13027-4f3c-43cd-b6d8-1b1fde903038', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '2df37dcb-52f7-46b4-9ad5-d2e68ab20b6e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('257c4136-91a4-435b-a10f-2a9cd9490e3f', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '7d03ee71-6d99-4ba0-b80e-daf71196da12');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('9bd550eb-6fac-4c59-8eb9-032f38986496', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '1becf00b-00ad-4650-bf6c-bb81853bf38a');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('c4e9b0fe-6190-499c-8227-3bf27a179165', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '3d2cac62-c9fe-42c6-ab43-b2118bfb7b3e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('89d979bf-5737-4b7c-b467-a9dece2ea3e5', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '3a76681b-c528-46b8-aa90-2b8dfd18bc7f');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('a0cf8412-51d8-4177-b7fd-1a922b5c5cd7', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'b356e7d1-f35a-44b1-998a-fe2984f55c80');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('cbc9afd1-4f0e-4a0b-819f-cee89929e62a', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '6f32f13c-93ac-4902-984d-557b4cecd48d');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('e5a26dbe-ad50-4288-bbda-388db777f753', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '39035505-7ae7-4395-83c0-38fcc96b33e3');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('b3e0601c-bd0b-4e27-9ae4-c4c749a5a1ce', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '27991925-c444-446d-8a3f-c1d481c962ea');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('8b62ecce-2e87-4257-ae26-24d87ec30016', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '4808834f-ed17-4dea-89d8-88b96ee2320d');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('512a2d37-1a2c-4204-b72a-afffc2b14f1e', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '0e92dabf-d924-4ace-90bf-9edd548d3933');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('9d04b6f1-2d19-409c-a709-e50d1129ee24', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '5cc3f1e2-0585-4562-9c13-5c0d82661edb');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('3379276b-330f-4bb3-9dc2-8026f886f338', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'd8f558b0-33a3-4f4d-b267-a488be211a2a');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('4274207a-a40d-4151-9e0b-b5934757b272', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '45f7728a-3468-4d29-9f44-45306877770e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('91be3a41-fc1c-48f2-89ad-4341110bcd05', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '334cde45-462b-4a0d-a815-969b62ce98fe');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('1ac82e4e-d518-4362-857f-b3c691792d06', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'c6621ceb-532d-4945-a7e5-77049cea9618');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('d3cca3dc-051a-48bb-a029-642e50ad0e0f', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '9d5d4d4e-8db0-4fb4-9b89-e30e6cf2b2ca');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('e3cc83b4-8863-4023-8e03-926a3e36c079', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'f4df94bb-a195-47b7-ae67-8eb7b875e11c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('68ea1ec1-a0c9-4966-8d10-6ba83a129a61', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '45378c1c-91ec-4b5f-a2f4-6076e35d6530');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('131edee6-3b58-41b5-9b53-1f18579e3c89', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '05cb9b58-c1ce-4194-a184-4d118637a8f4');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('13988a20-34ef-4286-a746-948e6c0f035b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '1a0a3a49-7f81-486e-8972-862b421b84f5');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('f2675e17-7a08-400b-8498-277412a29255', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '7ece4e0b-8504-4dd9-9e72-f62cd5c1415a');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('697e926c-9c93-45d4-bf9f-308d4c297cf1', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '4d26518c-9674-44ee-b267-0238f0d660ac');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('52c4f028-9c17-4955-bf62-785a8a633415', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '33529f02-05cd-479f-bb8a-34f790663b1c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('29414934-0fa1-47c2-80e6-715ebc1e9566', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'e95290dc-2ba2-4deb-a1b4-461ed70fa173');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('9d7cdd78-5af7-4f7a-8223-48fab599c38c', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'b9988168-26c4-4a8f-a57c-85a4aef8d733');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('6704df29-89c9-439f-8ffa-1ac7ec032a42', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '48d92bfd-7502-46fc-b0d8-8ec2c5c46074');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('fd5b1362-10fc-4d7e-b33d-8e026c0445cd', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '6e41e6dc-7f35-4a3a-9ec7-0ad3c22387ef');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('47f98945-a042-4431-a7c1-256421168493', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'd619c3fa-b136-4322-a2ce-277431da31f5');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('9e16eeff-f798-465d-9e9d-973a7be0d8fb', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '1d8b2cc7-9804-44fe-94c9-cf6d9616419a');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('9fedf2ac-b800-4356-8406-8625087226e4', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '9a1c7adc-d13a-4ab3-8ed4-bbe9c87d2b91');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('3919d586-7fe0-414f-b0ab-333c1d4fc340', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'bb866211-6766-4e83-9463-1af4cb87654d');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('cbe91187-c254-4c7b-aabe-ff042c51386f', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'f3fa23aa-9654-41d1-a63b-28a3bd5dd38c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('85e56cdd-8613-45b1-a998-e590ec970f8b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'dca4b2ae-75ff-4218-900c-acfbf783c2db');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('573f0566-9fc7-4002-b0e9-0f4d61fa8f43', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '0e2a19f0-12fc-4cdc-b208-13e388a7e57b');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('8fb3d8a1-b180-4e0c-bd2e-ff6592fa3637', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'abce26f8-f65c-40c5-85e3-8fc6be83f390');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('c42cffff-8512-4c6f-b87e-543f3f0ca6ae', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '6576ce8c-a4a5-4c67-b804-848730a82cc7');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('e8395509-2e37-4bf5-8a62-f3a485f314fb', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '648a33d6-a19e-458c-a739-00bc0b015b6f');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('3f845165-e2d1-4bab-8e3d-27ea79986427', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '6b9166f7-2572-4f84-ba19-71529dda4b57');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('50e8fb9f-9258-4626-95b4-7dd1a073a7f2', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '47bf2f42-312f-4087-9d74-bdccc9c4fe3c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('f5f39018-dd26-4b2a-851e-3a7fb11ab90d', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '5d341793-01f8-4dac-a691-25cfdee89959');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('c83c0241-764d-4035-aa82-62b3af48e894', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '0009a96d-509c-4b2a-93b5-3b037e87e01e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('094bf867-ec97-4f5e-bf5d-ba3d9643337b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '85b6cf31-74f9-4abb-98c8-ca4441825bf7');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('4a3ce0fb-b320-48fd-87c8-34864e72035b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '8e09758b-6315-4628-b696-75edcc4fae4e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('871805bc-a2e8-4024-a6b1-c73979a4696c', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'e420e462-8bad-48fe-8ff0-254e30864c38');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('11c43707-204b-41ec-b7c6-ffdad5409163', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '5f310cb4-1ad1-472a-8d1a-ec09626df0b0');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('5ded08bc-2743-4226-bb46-290d4932b12b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'dd6b1be6-c882-4247-8c5d-a26577353a56');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('5372d32f-7436-4bdc-8efb-7660d9cff283', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'e23084a0-8b46-4bca-b5d1-da4b4a241e4e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('56d207a0-d54c-4143-86c2-ed8c9cbb7fde', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '2f65a58a-cfaa-42dc-9965-e6139ee1d20e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('443411c9-2578-4852-b5e7-a5a6657eeb69', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'db9fc94c-f686-4e39-8f39-876bb0c8856c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('174515cb-8aec-4697-9a2b-8f60fb70f6c3', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '3162c65c-d44d-4d11-8821-c0ca452d8255');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('0e291e95-3879-4f2d-8484-57807d5735c9', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '9e5b9beb-cac5-493c-b2ce-78546b3dd42f');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('51147f54-5705-40b0-b98d-a43bcbf067f7', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '48d6e349-8330-47cc-9a23-2285cb35379d');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('f007e733-1688-48b5-afd1-6cedb140ced6', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '6b248420-bcb5-4517-9764-51e3729f4bde');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('11691af5-baa6-42ff-847e-595a95949f8e', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '99ceea69-be1c-4401-889a-fabb666a1727');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('8f93a0fa-4015-4b6a-acb7-f97e5483fb76', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '4bf69ff1-e94c-49ad-92b2-61331e0c3e11');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('bbcb09bd-c75b-4e07-9764-48fe6858f8ed', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '9e8d3f7a-e59e-4bcd-a6ee-c3bd0c9c86f9');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('a8af4b67-1edd-4731-a41c-2e8436d2f371', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '66e36809-494d-4941-b742-103a17d7bfd7');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('31ee81d2-b043-4f13-9ba1-d3c2cffcb28f', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '4cd7f8e0-ff4b-4286-9b56-1f7f65dafc68');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('448ffb2c-e519-4f87-9e5f-28639018425e', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'f79802e7-7015-45ad-820d-613502b2b675');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('359bce5d-4ae1-4172-b7f1-a60d0098ca41', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '2574ca0c-8316-43af-9aad-ea7625d76f78');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('6233e314-ba42-447a-8b06-6177ac8eb42d', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '9c87ff9e-b440-4cee-bbbf-72b9e03938b6');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('905b0c2c-4a5a-42e8-8801-475749432cb9', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'b215adb4-fd6a-4ad2-ae77-c79007b32780');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('7feda921-a443-42b5-a2ea-72db760c9e43', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'c6c11604-a2ad-4c33-8784-ee0ec9806ca6');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('c5c2e42a-cde6-43af-bbe5-86b658c7d347', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '830b4e2c-e420-4897-ae8c-ea43b210e530');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('8312a2dc-15b1-4c78-b698-cd4a425226cf', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '7b6e4645-e291-40de-86bc-0973f23729e9');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('bf103423-08a2-449d-a032-5631ec28c92c', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '1ab5c491-c1ba-4234-ae24-b2e0c7625b80');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('acabfd42-cc1e-4de6-869a-de6e4ca467ee', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'f7718b82-24d7-4c95-880e-34e00fc30d7b');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('f123032b-cf00-43dd-a957-a7cc7cd2136c', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'dadbcf9d-7065-4a06-8ff4-f654663c3ce0');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('cdde6f00-5b5f-4a0b-9ae3-3cbfc2fcddda', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'c9dc0feb-5ee9-414c-a116-3518c328c5e0');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('47effb86-1e6c-4d1d-bd1c-6b2b4a9d32a2', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '04288ba9-ace6-4771-89ad-7fc563aa9ff7');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('507e95e3-005d-4523-9713-945ee7e0fc24', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '2ebee302-24f8-4b68-94ef-586ff2fce445');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('e620eb32-8d1b-45f1-959f-2b86c573c28f', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '1a12afca-2c14-4718-9b43-098a7066f16a');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('bf3f4829-3c12-4c40-ab41-0994c70da541', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'c640d839-616f-4c82-84c1-6b84d57f053c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('24cd3e6f-c117-4c5a-ad03-89a262f76ee2', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '5e9a79f1-1935-43cc-9717-fff2f642290f');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('dbdb0a5c-99d7-47ca-9927-8ada67f65634', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '32b97d39-92c8-4756-830d-a8e7922d70ff');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('3c1e6233-5dc4-43b5-98bb-25369133419b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '2cdd26a5-48cd-4f10-9c7f-87cbe2a706cf');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('c4d07f24-ecc5-478b-96ba-2ec9ca9cbcc2', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '32da6257-0f2b-47bf-869d-f008d6d8e3f9');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('6e114fc6-e1d9-46d6-8672-44779e8ce666', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '808b34d8-9627-4084-8a1b-0056a08aba49');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('2419f4bd-0174-4584-98a9-4cd2e86ffd76', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '874bc2f8-528b-416b-82be-75a8b8debf9f');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('545eb4f6-acca-4f3c-8a49-4c845cd9cd4b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '4de89679-7b80-4253-8a61-89d926c62e61');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('94d511ce-4dc3-47f2-a977-502ba23447cb', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '51f87d39-0130-48b4-b30a-44c0cb88f4a5');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('bb8102ff-041b-43f0-b2d6-c3034f7bbe04', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '5da0f6ab-6917-4b25-ab19-383a63eb31a4');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('f43c1fb2-746b-4b1a-a1b6-ee88883e7b58', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '054205bb-e304-49a6-8676-f5411b52aef4');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('64cf4104-89f6-4b22-aa9a-cfd7a4128cb6', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'bcf038ea-a450-4e22-abbf-8c8d3a07e223');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('f068e33a-e846-4ada-8fab-3f7fd6d2cf9e', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '6ed7baa7-8335-4398-a6b7-7fb07a924c41');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('8cae9163-e7fe-49f9-844a-8f129274330e', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'bc926b96-6fee-429d-af71-e3a70cdf4fdb');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('4b61bcac-70c8-4ada-b6fc-ff65a4eb400f', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '612e6f08-9253-45b1-b320-24ad53469be2');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('744c4ee5-91bb-47ae-aa26-ba4f1e6b3028', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'd6f063f9-bedb-4ef5-9ac0-0b2ce0ca5ae7');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('55cb3074-1b95-4102-80c0-0d4e0d15df15', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '8b7e6cbf-8250-49c8-8c28-584b7f170ff9');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('cf1b5f7c-e580-4bde-9a3b-3f2c39061326', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'bc4b9002-b027-4b88-9ad2-0779abab6773');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('530105e9-d26a-4c0c-9a2e-2ef02fd1a29e', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'd25f463a-446d-458a-9a52-d4df47c67fca');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('0cea028b-2dbb-4060-a177-0c094404440a', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '59fc27f6-cb80-4a8a-ad1b-a6ea5358f38c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('0e24cb14-d7ac-4805-b7c2-cef9515fb01c', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '98479205-bc62-4cd9-80b3-f6870d0b8b8e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('a7840d23-6177-47f6-9e81-2f99879f616a', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '2930dfd5-39ee-447a-a135-5f56f21a72a4');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('57d7fa35-e042-4dae-bafb-347bb8b64841', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'd7d393f3-7674-4b0b-bef0-99f80c06fa63');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('da67f733-ce7c-4826-bf5d-9c1fd1f6418f', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '7200f76c-f669-474f-a71e-bfc71763b480');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('04e033ed-fd1f-4c52-97ed-53e232c1047b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'b9235ea7-41ff-4e88-a5d6-9e6382765b94');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('2334ca9f-f9b9-42ba-a230-5bcab995bb0b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '91a92b66-8977-44d1-bfe5-18a1d055eb61');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('b6c05bcf-1e05-4edb-bf08-b49a3517c31c', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'e6231d4d-098e-45b1-832a-383a2a97a51a');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('24c698e8-cae4-46b7-8ba8-1bbf0a0925bf', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '0cd5bed3-aabc-4f15-a4af-ee248e06b55a');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('0147c83b-b3e2-4779-ac06-c657691e0309', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '44b8ad34-dd51-4b2b-8ba5-58dfe7f24c5c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('fe23e7bc-3949-4cc3-9ffd-7c0700d14f37', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '8b408f11-d070-4c75-a812-6b3404d96a63');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('af43a3e9-1377-4794-8501-db429bf3792c', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'a150d944-41c6-46d0-8cf9-21d66bf63f58');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('069fb34e-78cd-4e00-b72c-51e91e4d25a4', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'bac03d27-044d-47f7-bb3c-ded0668c924f');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('1be8869a-7c2e-40f3-b670-814e0ec0a5ea', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'f67c7c54-0a27-4c28-a142-9779ce05980e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('1c36c30f-c969-4047-b1d3-b8610d869a53', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'db45d199-25e6-4128-acf0-ac4087dc19a2');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('2f249ec9-cceb-40aa-8799-fc2529df349d', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'cb36cc6a-8893-447e-9ed5-be3020945e04');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('dde0453f-f49e-495f-bd87-486894181443', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'b496a392-7e4f-41b0-b951-7dc319452b54');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('55cb73ad-d412-4584-9c84-fafd014114de', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '0bc61d2a-f4b0-48a2-b420-fbf4831a4949');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('685f6c0b-9cc9-4711-a65a-756c53943f62', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '852ecd73-d2ba-4030-a389-6f97452881c3');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('c5dadbf2-447f-4a33-bdfb-682cb021c419', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '7e8989ab-10dd-4507-838f-39e12df42b8b');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('ce4de6c7-ef45-4d08-9358-b513543d083f', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '007d31d0-11c4-47e0-807c-99267fe46971');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('9765f5e9-c7bb-40ac-a922-a9d2664cd32d', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '913673a1-c299-4df4-9806-7c40b04e724c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('d5bf7287-b8a7-4f4a-b2c8-bcfed77ae03e', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '807d7d50-ea03-4074-bc79-8ebb298b66c0');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('17f744bd-5e79-4ea8-be39-14ddbd153780', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '73c9cab5-96df-43d3-8f05-973de7c83f5b');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('80960f79-f4d6-4a1d-8cc9-a38d02e7ffa2', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '073fa9ea-92a6-4e71-9b31-e0d61d422eb9');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('ecb19d19-e3ec-4ac6-b04a-1c0313a4ef21', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'a4fbe2de-63df-490c-9993-feb4b17ea94c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('16bc58ee-b4a9-4a50-9419-889bdf3f21af', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '362e0943-ba6f-4139-8c11-afa5630aaae8');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('60a662a1-6d0c-4e65-9dfe-c302c123c361', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'c198a522-847e-48d3-89fe-2c2e7d989bc9');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('518f751a-b560-4db2-b057-83ef392d8e4a', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '079bc365-b769-4942-923d-04adefde7531');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('d1e1b954-68a1-4c3e-b915-83699012ebaa', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'ae614ce6-a9d7-4d06-af42-7546cea3f56e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('e276163a-1a73-46f7-86cd-9ff2763c1322', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '47eb915a-0ffc-4a6a-9e8e-4137dbda9f30');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('2a48ba04-8f52-458e-846f-a12b95a28b2a', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '5396d5c2-8090-43a3-82bc-eb02f418d16a');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('5a045835-a225-40e9-86b0-165416496551', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'b6166efa-8eee-4074-b681-0daa0eb1049b');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('d0350246-8c1a-435c-93dc-f3dbc4e23611', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '99c8dc4d-80bf-4e86-8bd5-30e4aa21f436');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('9d77c637-eeb5-419e-84d7-e48e672b6917', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'dfcd1056-cd66-4877-994c-ca8aa213413e');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('e5da97c4-0082-403c-bf14-2a8773544674', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '6d70b24a-47dd-41fe-a229-b42107ee0681');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('227d4889-19d8-4af0-aacc-24eb0c099fa1', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '049571e5-139d-4fa0-b388-9dae077d9f33');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('7e00435e-e66c-4227-8149-2fe8b0385090', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '5b828060-14da-4da8-80b3-dbcd56534651');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('dde15ec0-afaa-499e-9f33-41ccb7bd8deb', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'b3ffdda2-c8fd-4bfc-92db-30eae6bcd58d');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('fee6f4be-c997-4464-a367-d4d48f6047f6', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'e01e4479-deaa-4f8b-9ff9-00868023ce4b');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('67a0e127-9c96-4be0-9d00-b61cabf05665', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '63ea7f1a-3a24-4e6c-bf2d-cbdc69522659');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('f71395f0-92d9-4a7f-b43e-914ee80cfa55', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '610c3d36-460b-4d63-8538-500334c72454');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('1facad5a-57a0-4c6f-9b2d-ddfc9faed13e', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'a471f258-bf5c-49c6-8d2d-58dfd7953698');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('cc7e394f-0991-462c-ac12-6ac2e3a2673f', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'b924fae6-b6ff-48f4-ae61-031ef90da321');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('9a311efb-3935-48af-b032-b239c72ddb8a', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'd618e04f-892d-4703-a4d1-702180dbd708');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('c8a933e1-3c19-4d64-aa25-37a46adf9dc8', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '22d866f1-a937-4661-b0fd-9ba1b2a12c19');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('562a0995-d333-4946-8366-019bfefefac5', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '29a03f13-a28c-4e59-af0b-97aad5884d61');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('bf92e5ab-d5c6-4a43-aa03-5c7ff40f21c3', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '2e5ebb00-7eab-426a-86f9-f536312d8b34');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('6eb32a66-667b-413e-a256-84314dde3ed5', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '3ebbae38-6dd7-43b2-b1e8-e2e71d40d374');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('c6392729-ea2e-4e4f-813f-010914b6a45f', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '78f567a6-502d-4a5f-ba29-b97426430f19');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('88d00e96-970f-4d56-affb-0aa2a9aecadc', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '27891776-9886-45c4-ba74-54e57c1d116d');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('461005e0-3b55-49b3-9aa6-9de01ce19259', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '86fe5d77-0b09-4aee-98ef-93d575c38dbd');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('c2ae4d3e-60d0-440d-b568-1af7d4b5c928', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'b00fa3cf-7acc-4c4d-9860-dfd1273bb461');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('26e5bd51-21f1-489d-a01a-da805b82f7ec', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'e337d856-bf6d-4c02-ac06-ce1e877de653');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('6968971c-bd51-412d-a872-fec7a3879b58', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '0300addd-de3d-4107-999c-272500eee293');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('2899f45e-0789-4aa4-8d7e-930bcef5efa2', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '541975b3-8744-427b-b0e2-47092e5caa2c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('d5854237-d8f9-40d1-acfe-c97eb8f47611', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '6c3c239d-f0e9-418a-859e-534e8a329ec5');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('136a49ac-972a-4d26-b51e-9f253ed205e7', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '0a13c863-cd59-40a6-967a-428a741000f9');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('69a8347a-3ad0-4dcc-a147-7d30792f1b71', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '726ba0b9-bc7b-44ce-af75-8cccc423a538');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('597c8007-03b6-463f-9841-ff63a55dab29', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'c700d4e7-7aa1-4aed-9376-ef149c886c9b');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('56b3bf60-8a6d-49bf-8dd3-081867e17050', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'e5d5efd4-22df-4fb1-a2c2-a7b140505b94');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('bf84f939-971a-4af1-86fc-49daea5b0b9c', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '1f4dde51-0199-4ad4-aa40-6690b4ebbdfb');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('8b91eead-8f99-4c94-b709-72326e476271', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '80465de4-9076-4ef4-a6c8-8c5ba9641d98');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('99e80bc0-fd06-4fe8-b1ab-935b7373295d', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'f9c42ba5-c956-424d-8fc6-d8502e4bab6c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('0ace71da-3394-490a-91ae-7352adb31545', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '55a64362-9aa5-45b3-b657-e5679b9f16a7');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('3497bd91-6def-4854-b1a9-770d106d0f10', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'f0ee4db2-0b7c-4838-9ea5-1918187f6c21');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('dfb53e72-15cb-41a4-ad07-ebbe6661513b', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '4092051c-496f-4c28-9058-be7bb74f146b');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('64cb296d-bc2e-4849-90c0-aeb878926a30', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'b9c0292c-b4fb-4544-a47e-c1e9dc83ff0b');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('96f40513-5abb-4586-8734-9a4526a74e7f', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'ace140aa-571a-4b62-9aa1-264397bbaeab');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('3e131599-73c1-43bd-be3b-6ea475e30b85', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'fc288acf-9df8-4f0d-86e0-10c8971ffe80');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('df40508d-551a-4993-a748-bd03d0c848ab', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '54cb7933-87c3-452e-bdde-3801bd2dd861');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('e9070291-476b-4ae0-b603-91eafc2cbbd8', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '91d69536-e70e-47bf-a7c3-c692e59880bb');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('0831d649-8371-4a00-8e06-4dd2bdbfa3ec', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '0f2ea9e4-c845-400e-bcb9-fe3039a4cf2c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('406b2188-4fc1-4d56-9022-7ba9292865c6', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'b0e248d1-e07a-4fca-9e8f-11c2dd5e8565');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('7100f690-535d-4ed7-8aa2-011372a127cb', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '945e0759-607e-4472-862d-bf24d916e2e2');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('5c6a2b01-abba-4265-b095-9b507dd2b4ed', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', 'ffdd35ef-5a45-4821-b2bf-3a3ba1fa79d3');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('122e38e4-fcda-4c9a-a91f-69a5d95dc066', 'cecb5af1-c24c-4141-84b1-95f9bfce6312', '34fabee5-c798-4f0a-8e60-c11278fb677a');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('65169c7a-248e-45d5-a042-ab853f36785d', '6af8b2de-1143-4722-9d6f-85266d9277a0', '830b4e2c-e420-4897-ae8c-ea43b210e530');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('150be7a5-3326-41c3-964d-606017f7f327', '6af8b2de-1143-4722-9d6f-85266d9277a0', '1ab5c491-c1ba-4234-ae24-b2e0c7625b80');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('54b1492d-f45e-4324-a272-24e74894aef4', '6af8b2de-1143-4722-9d6f-85266d9277a0', 'dadbcf9d-7065-4a06-8ff4-f654663c3ce0');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('e1584aef-59c4-450a-92ca-88cff6bc89e0', '6af8b2de-1143-4722-9d6f-85266d9277a0', '32b97d39-92c8-4756-830d-a8e7922d70ff');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('7eba41d6-85cb-495f-847e-15e266187775', '6af8b2de-1143-4722-9d6f-85266d9277a0', '874bc2f8-528b-416b-82be-75a8b8debf9f');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('cc139aff-25b1-41a8-973c-e83d71ab11d1', '6af8b2de-1143-4722-9d6f-85266d9277a0', '4de89679-7b80-4253-8a61-89d926c62e61');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('98c47faf-ed26-4130-858c-b301832da980', '6af8b2de-1143-4722-9d6f-85266d9277a0', '51f87d39-0130-48b4-b30a-44c0cb88f4a5');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('5674b4d4-cc0f-454a-97b2-bcf0f1c023a2', '6af8b2de-1143-4722-9d6f-85266d9277a0', '6ed7baa7-8335-4398-a6b7-7fb07a924c41');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('0ea75a73-af58-404e-bb9c-87601c826919', '6af8b2de-1143-4722-9d6f-85266d9277a0', 'd25f463a-446d-458a-9a52-d4df47c67fca');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('d6af8cfc-55ab-496f-92da-845c3780541a', '6af8b2de-1143-4722-9d6f-85266d9277a0', '2930dfd5-39ee-447a-a135-5f56f21a72a4');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('ff1bf93d-5beb-499f-8675-fe6ebe7e0a7c', '6af8b2de-1143-4722-9d6f-85266d9277a0', 'd7d393f3-7674-4b0b-bef0-99f80c06fa63');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('ccebdf9a-d128-4115-97aa-13f8ba1eed3a', '6af8b2de-1143-4722-9d6f-85266d9277a0', '91a92b66-8977-44d1-bfe5-18a1d055eb61');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('44ffbd27-537e-4603-a02c-a2f94f3477df', '6af8b2de-1143-4722-9d6f-85266d9277a0', 'e6231d4d-098e-45b1-832a-383a2a97a51a');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('9c641f49-0cbc-47ab-ac23-bb7de839c02d', '6af8b2de-1143-4722-9d6f-85266d9277a0', 'a150d944-41c6-46d0-8cf9-21d66bf63f58');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('144088ba-0e93-4821-81e0-a16c388c1848', '6af8b2de-1143-4722-9d6f-85266d9277a0', 'bac03d27-044d-47f7-bb3c-ded0668c924f');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('d48e6c3d-3663-449a-81dc-29d9ed50a390', '6af8b2de-1143-4722-9d6f-85266d9277a0', '913673a1-c299-4df4-9806-7c40b04e724c');
INSERT INTO public."RolePermission" (id, "roleId", "permissionId") VALUES ('8ab67b62-cc9a-452b-8a58-4d8787d6b56a', '6af8b2de-1143-4722-9d6f-85266d9277a0', '807d7d50-ea03-4074-bc79-8ebb298b66c0');


ALTER TABLE public."RolePermission" ENABLE TRIGGER ALL;

--
-- Data for Name: SalaryBreakup; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."SalaryBreakup" DISABLE TRIGGER ALL;



ALTER TABLE public."SalaryBreakup" ENABLE TRIGGER ALL;

--
-- Data for Name: Session; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."Session" DISABLE TRIGGER ALL;



ALTER TABLE public."Session" ENABLE TRIGGER ALL;

--
-- Data for Name: SocialSecurityInstitution; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."SocialSecurityInstitution" DISABLE TRIGGER ALL;



ALTER TABLE public."SocialSecurityInstitution" ENABLE TRIGGER ALL;

--
-- Data for Name: SocialSecurityEmployerRegistration; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."SocialSecurityEmployerRegistration" DISABLE TRIGGER ALL;



ALTER TABLE public."SocialSecurityEmployerRegistration" ENABLE TRIGGER ALL;

--
-- Data for Name: SocialSecurityEmployeeRegistration; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."SocialSecurityEmployeeRegistration" DISABLE TRIGGER ALL;



ALTER TABLE public."SocialSecurityEmployeeRegistration" ENABLE TRIGGER ALL;

--
-- Data for Name: SocialSecurityContribution; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."SocialSecurityContribution" DISABLE TRIGGER ALL;



ALTER TABLE public."SocialSecurityContribution" ENABLE TRIGGER ALL;

--
-- Data for Name: SubDepartment; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."SubDepartment" DISABLE TRIGGER ALL;



ALTER TABLE public."SubDepartment" ENABLE TRIGGER ALL;

--
-- Data for Name: TaxSlab; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."TaxSlab" DISABLE TRIGGER ALL;



ALTER TABLE public."TaxSlab" ENABLE TRIGGER ALL;

--
-- Data for Name: UserPreference; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."UserPreference" DISABLE TRIGGER ALL;



ALTER TABLE public."UserPreference" ENABLE TRIGGER ALL;

--
-- Data for Name: WorkingHoursPolicy; Type: TABLE DATA; Schema: public; Owner: postgres
--

ALTER TABLE public."WorkingHoursPolicy" DISABLE TRIGGER ALL;



ALTER TABLE public."WorkingHoursPolicy" ENABLE TRIGGER ALL;

--
-- PostgreSQL database dump complete
--

\unrestrict EkUO761yHaQEwM7fRh0VjVqhDe7B1XjU3Wfl0ccUkdazwHc1nmrrb6IU5WxWEhK

